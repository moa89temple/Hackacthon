import 'package:flutter/material.dart';

import 'app.dart';
import 'backend/buddy_backend.dart';

/// 10.0.2.2 is how the Android emulator reaches the laptop it runs on.
final _backendUrl = Uri.parse('http://10.0.2.2:8787');

void main() {
  runApp(BuddyApp(backend: HttpBuddyBackend(_backendUrl)));
}
