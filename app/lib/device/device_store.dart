import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// This phone's pairing with the backend.
class PairedDevice {
  const PairedDevice({required this.address, required this.key});

  final Uri address;
  final String key;
}

abstract interface class DeviceStore {
  /// The pairing saved on this phone, if there is one.
  Future<PairedDevice?> read();
  Future<void> save(PairedDevice device);
  Future<void> forget();
}

/// Keeps the pairing in the phone's secure storage, encrypted with a key from its keystore.
class SecureDeviceStore implements DeviceStore {
  static const _name = 'paired-device';
  static const _storage = FlutterSecureStorage();

  @override
  Future<PairedDevice?> read() async {
    try {
      final saved = await _storage.read(key: _name);
      if (saved == null) return null;
      final json = jsonDecode(saved) as Map<String, dynamic>;
      return PairedDevice(address: Uri.parse(json['address'] as String), key: json['key'] as String);
    } on Exception {
      // Unreadable, for example after the keystore was reset. Pairing again puts it right.
      return null;
    }
  }

  @override
  Future<void> save(PairedDevice device) =>
      _storage.write(key: _name, value: jsonEncode({'address': device.address.toString(), 'key': device.key}));

  @override
  Future<void> forget() => _storage.delete(key: _name);
}
