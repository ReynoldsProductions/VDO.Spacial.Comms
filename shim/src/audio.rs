use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, StreamConfig};
use ringbuf::{HeapConsumer, HeapProducer, HeapRb};
use std::sync::Arc;

pub const CHANNEL_COUNT: usize = 4;
pub const FRAME_SIZE: usize = 480; // 10ms @ 48kHz

pub struct AudioChannels {
    pub capture_consumers: Vec<HeapConsumer<f32>>,
    pub playback_producers: Vec<HeapProducer<f32>>,
}

pub struct AudioStreams {
    _input: cpal::Stream,
    _output: cpal::Stream,
}

pub struct DeviceInfo {
    pub name: String,
    pub channels: u16,
}

fn probe_max_input_channels(device: &cpal::Device, sample_rate: u32) -> u16 {
    for &count in &[32u16, 16, 8, 4, 2, 1] {
        let config = cpal::StreamConfig {
            channels: count,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };
        let result = device.build_input_stream(
            &config,
            |_data: &[f32], _| {},
            |_| {},
            None,
        );
        if result.is_ok() {
            return count;
        }
    }
    1
}

fn probe_max_output_channels(device: &cpal::Device, sample_rate: u32) -> u16 {
    for &count in &[32u16, 16, 8, 4, 2, 1] {
        let config = cpal::StreamConfig {
            channels: count,
            sample_rate: cpal::SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };
        let result = device.build_output_stream(
            &config,
            |_data: &mut [f32], _| {},
            |_| {},
            None,
        );
        if result.is_ok() {
            return count;
        }
    }
    1
}

fn max_input_channels(device: &cpal::Device) -> u16 {
    let from_configs = device.supported_input_configs()
        .ok()
        .and_then(|cfgs| cfgs.map(|c| c.channels()).max())
        .unwrap_or(0);

    if from_configs > 2 {
        return from_configs;
    }
    // supported_input_configs() may underreport on macOS CoreAudio — probe directly
    probe_max_input_channels(device, 48000)
}

fn max_output_channels(device: &cpal::Device) -> u16 {
    let from_configs = device.supported_output_configs()
        .ok()
        .and_then(|cfgs| cfgs.map(|c| c.channels()).max())
        .unwrap_or(0);

    if from_configs > 2 {
        return from_configs;
    }
    // supported_output_configs() may underreport on macOS CoreAudio — probe directly
    probe_max_output_channels(device, 48000)
}

pub fn list_input_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devs| devs.filter_map(|d| {
            Some(DeviceInfo { channels: max_input_channels(&d), name: d.name().ok()? })
        }).collect())
        .unwrap_or_default()
}

pub fn list_output_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devs| devs.filter_map(|d| {
            Some(DeviceInfo { channels: max_output_channels(&d), name: d.name().ok()? })
        }).collect())
        .unwrap_or_default()
}

pub fn start(input_substr: &str, output_substr: &str, sample_rate: u32) -> Result<(AudioChannels, AudioStreams)> {
    let host = cpal::default_host();
    let input_dev = find_input_device(&host, input_substr)?;
    let output_dev = find_output_device(&host, output_substr)?;

    // Use the device's actual channel count, capped at CHANNEL_COUNT.
    // Opening with a hardcoded count on a 2-ch device produces garbled deinterleaving.
    let in_ch = (max_input_channels(&input_dev) as usize).min(CHANNEL_COUNT).max(1);
    let out_ch = (max_output_channels(&output_dev) as usize).min(CHANNEL_COUNT).max(1);
    tracing::info!("opening input with {in_ch} ch, output with {out_ch} ch");

    // Request 480-sample (10ms) buffers for steady frame delivery.
    // CoreAudio may round to the nearest supported size but will stay close.
    // Using Default often yields 4096+ samples, causing bursty delivery and stutter.
    let in_config = StreamConfig {
        channels: in_ch as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Fixed(FRAME_SIZE as u32),
    };
    let out_config = StreamConfig {
        channels: out_ch as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Fixed(FRAME_SIZE as u32),
    };

    let mut cap_producers: Vec<HeapProducer<f32>> = Vec::new();
    let mut cap_consumers: Vec<HeapConsumer<f32>> = Vec::new();
    let mut pb_producers: Vec<HeapProducer<f32>> = Vec::new();
    let mut pb_consumers: Vec<HeapConsumer<f32>> = Vec::new();

    for _ in 0..CHANNEL_COUNT {
        let rb = HeapRb::<f32>::new(FRAME_SIZE * 16);
        let (p, c) = rb.split();
        cap_producers.push(p);
        cap_consumers.push(c);

        let rb = HeapRb::<f32>::new(FRAME_SIZE * 16);
        let (p, c) = rb.split();
        pb_producers.push(p);
        pb_consumers.push(c);
    }

    let cap_producers = Arc::new(std::sync::Mutex::new(cap_producers));
    let pb_consumers = Arc::new(std::sync::Mutex::new(pb_consumers));

    let cap_producers_clone = cap_producers.clone();
    let input_stream = input_dev
        .build_input_stream(
            &in_config,
            move |data: &[f32], _| {
                let mut prods = cap_producers_clone.lock().unwrap();
                for (i, &sample) in data.iter().enumerate() {
                    let ch = i % in_ch;  // deinterleave using actual device channel count
                    let _ = prods[ch].push(sample);
                }
            },
            |e| tracing::error!("input stream error: {e}"),
            None,
        )
        .context("build input stream")?;

    let pb_consumers_clone = pb_consumers.clone();
    let output_stream = output_dev
        .build_output_stream(
            &out_config,
            move |data: &mut [f32], _| {
                let mut cons = pb_consumers_clone.lock().unwrap();
                for (i, sample) in data.iter_mut().enumerate() {
                    let ch = i % out_ch;  // interleave using actual device channel count
                    *sample = cons[ch].pop().unwrap_or(0.0);
                }
            },
            |e| tracing::error!("output stream error: {e}"),
            None,
        )
        .context("build output stream")?;

    input_stream.play().context("play input stream")?;
    output_stream.play().context("play output stream")?;

    Ok((
        AudioChannels {
            capture_consumers: cap_consumers,
            playback_producers: pb_producers,
        },
        AudioStreams {
            _input: input_stream,
            _output: output_stream,
        },
    ))
}

fn name_matches(cpal_name: &str, query: &str) -> bool {
    let a = cpal_name.to_lowercase();
    let b = query.to_lowercase();
    // Web Audio API appends "(Virtual)", "(Built-in)" etc. that CPAL omits.
    // Accept if either string is a substring of the other.
    a.contains(&b) || b.contains(&a)
}

fn find_input_device(host: &cpal::Host, substr: &str) -> Result<Device> {
    if substr.is_empty() {
        return host.default_input_device().context("no default input device");
    }
    let devs: Vec<Device> = host.input_devices().context("enumerate input devices")?.collect();
    let names: Vec<String> = devs.iter().filter_map(|d| d.name().ok()).collect();
    tracing::info!("available input devices: {:?}", names);
    devs.into_iter()
        .find(|d| d.name().map(|n| name_matches(&n, substr)).unwrap_or(false))
        .context(format!("no input device matching '{substr}' — available: {names:?}"))
}

fn find_output_device(host: &cpal::Host, substr: &str) -> Result<Device> {
    if substr.is_empty() {
        return host.default_output_device().context("no default output device");
    }
    let devs: Vec<Device> = host.output_devices().context("enumerate output devices")?.collect();
    let names: Vec<String> = devs.iter().filter_map(|d| d.name().ok()).collect();
    tracing::info!("available output devices: {:?}", names);
    if let Some(dev) = devs.into_iter().find(|d| d.name().map(|n| name_matches(&n, substr)).unwrap_or(false)) {
        return Ok(dev);
    }
    // CoreAudio does not always enumerate the default output (e.g. built-in speakers).
    // Check the default device by name first, then fall back to it unconditionally
    // so the shim never crashes due to a stale device name in config.
    if let Some(def) = host.default_output_device() {
        let def_name = def.name().unwrap_or_default();
        tracing::info!("default output device: {:?}", def_name);
        if name_matches(&def_name, substr) {
            return Ok(def);
        }
        tracing::warn!("output '{substr}' not found — falling back to default '{def_name}'");
        return Ok(def);
    }
    anyhow::bail!("no output device matching '{substr}' — available: {names:?}")
}
