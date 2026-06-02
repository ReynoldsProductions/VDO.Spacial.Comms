#include <napi.h>
#include <CoreAudio/CoreAudio.h>
#include <vector>
#include <string>

static std::string getStringProperty(AudioDeviceID id,
                                     AudioObjectPropertySelector sel,
                                     AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal) {
  CFStringRef str = nullptr;
  UInt32 size = sizeof(str);
  AudioObjectPropertyAddress addr = { sel, scope, kAudioObjectPropertyElementMain };
  if (AudioObjectGetPropertyData(id, &addr, 0, nullptr, &size, &str) != noErr || !str)
    return "";
  char buf[512];
  CFStringGetCString(str, buf, sizeof(buf), kCFStringEncodingUTF8);
  CFRelease(str);
  return std::string(buf);
}

static int getChannelCount(AudioDeviceID id, AudioObjectPropertyScope scope) {
  AudioObjectPropertyAddress addr = {
    kAudioDevicePropertyStreamConfiguration, scope, kAudioObjectPropertyElementMain
  };
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(id, &addr, 0, nullptr, &size) != noErr || size == 0)
    return 0;
  std::vector<uint8_t> buf(size);
  auto* list = reinterpret_cast<AudioBufferList*>(buf.data());
  AudioObjectGetPropertyData(id, &addr, 0, nullptr, &size, list);
  int total = 0;
  for (UInt32 i = 0; i < list->mNumberBuffers; i++)
    total += list->mBuffers[i].mNumberChannels;
  return total;
}

static Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioObjectPropertyAddress addr = {
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };
  UInt32 size = 0;
  AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &addr, 0, nullptr, &size);
  std::vector<AudioDeviceID> ids(size / sizeof(AudioDeviceID));
  AudioObjectGetPropertyData(kAudioObjectSystemObject, &addr, 0, nullptr, &size, ids.data());

  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;
  for (auto devId : ids) {
    int inCh  = getChannelCount(devId, kAudioDevicePropertyScopeInput);
    int outCh = getChannelCount(devId, kAudioDevicePropertyScopeOutput);
    if (inCh == 0 && outCh == 0) continue;
    Napi::Object dev = Napi::Object::New(env);
    dev.Set("name",        Napi::String::New(env, getStringProperty(devId, kAudioDevicePropertyDeviceNameCFString)));
    dev.Set("uid",         Napi::String::New(env, getStringProperty(devId, kAudioDevicePropertyDeviceUID)));
    dev.Set("inChannels",  Napi::Number::New(env, inCh));
    dev.Set("outChannels", Napi::Number::New(env, outCh));
    result[idx++] = dev;
  }
  return result;
}

static Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  return info.Env().Undefined();
}
static Napi::Value StopCapture(const Napi::CallbackInfo& info) {
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices",  Napi::Function::New(env, ListDevices));
  exports.Set("startCapture", Napi::Function::New(env, StartCapture));
  exports.Set("stopCapture",  Napi::Function::New(env, StopCapture));
  return exports;
}
NODE_API_MODULE(coreaudio, Init)
