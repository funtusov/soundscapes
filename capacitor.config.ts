import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.etherpad.soundscape',
  appName: 'EtherPad Soundscape',
  webDir: 'dist',
  // Uncomment for live reload during development:
  // server: {
  //   url: 'http://192.168.1.XXX:5173',  // Replace with your local IP
  //   cleartext: true
  // }
};

export default config;
