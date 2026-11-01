import 'package:flutter/foundation.dart';

/// How the Android emulator reaches the laptop it runs on. It's the one address that can be plain
/// HTTP, because there the traffic never leaves the laptop. On a real phone the same address could
/// be another machine, so only debug builds accept it, and a real phone runs a release build.
const emulatorAddress = 'http://10.0.2.2:8787';
const _emulatorHost = '10.0.2.2';
const emulatorAllowed = !kReleaseMode;

/// What it takes to pair: where the backend is, and the code it made.
class PairingDetails {
  const PairingDetails({required this.address, required this.code});

  final Uri address;
  final String code;

  /// Reads what the backend's pairing QR code holds, or returns null if this isn't one.
  static PairingDetails? fromQr(String text) {
    final link = Uri.tryParse(text.trim());
    if (link == null || link.scheme != 'buddy' || link.host != 'pair') return null;
    final address = parseBackendAddress(link.queryParameters['address'] ?? '');
    final code = link.queryParameters['code'];
    if (address == null || code == null || code.isEmpty) return null;
    return PairingDetails(address: address, code: code);
  }
}

/// Returns the backend's address from what was scanned or typed, or null if the app shouldn't
/// connect to it. Anything but the emulator must be HTTPS, so that a device key and a Takeover
/// never cross a network in the clear.
Uri? parseBackendAddress(String text, {bool allowEmulator = emulatorAllowed}) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) return null;
  final parsed = Uri.tryParse(trimmed.contains('://') ? trimmed : 'https://$trimmed');
  if (parsed == null || parsed.host.isEmpty) return null;
  final allowed = parsed.scheme == 'https' || (allowEmulator && parsed.scheme == 'http' && parsed.host == _emulatorHost);
  return allowed ? Uri.parse(parsed.origin) : null;
}
