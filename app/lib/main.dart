import 'package:flutter/material.dart';

import 'app.dart';
import 'backend/buddy_backend.dart';
import 'briefings/firebase_phone_notifications.dart';
import 'device/app_lock.dart';
import 'device/device_store.dart';

void main() {
  runApp(
    BuddyApp(
      deviceStore: SecureDeviceStore(),
      appLock: DeviceAppLock(),
      access: HttpBackendAccess(),
      phoneNotifications: FirebasePhoneNotifications(),
    ),
  );
}
