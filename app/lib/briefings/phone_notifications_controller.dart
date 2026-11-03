import 'dart:async';

import 'package:flutter/foundation.dart';

import 'briefing_backend.dart';
import 'phone_notifications.dart';

enum PhoneNotificationStatus {
  /// Still finding out.
  checking,

  /// This build has no Firebase config.
  notInThisBuild,

  /// The Student hasn't allowed notifications for Buddy on this phone.
  notAllowed,

  /// Firebase gave this phone no token, as on an emulator without Google Play.
  noToken,

  /// The backend couldn't be told the token.
  notRegistered,

  /// The backend has this phone's token.
  registered,
}

/// Connects the phone's notifications to the backend. It's made after the first unlock, so that a locked
/// app asks nothing of anyone.
class PhoneNotificationsController extends ChangeNotifier {
  PhoneNotificationsController(this._backend, this._phone, {required this.onOpened, required this.onArrived});

  final BriefingBackend _backend;
  final PhoneNotifications _phone;

  /// The Student tapped a Briefing notification.
  final VoidCallback onOpened;

  /// A Briefing arrived while the app was open.
  final VoidCallback onArrived;

  final List<StreamSubscription<Object?>> _listening = [];
  bool _disposed = false;
  String? _saved;

  PhoneNotificationStatus status = PhoneNotificationStatus.checking;

  Future<void> start() async {
    if (!await _phone.setUp()) {
      _setStatus(PhoneNotificationStatus.notInThisBuild);
      return;
    }
    if (_disposed) return;
    _listening
      ..add(_phone.briefingOpened.listen((_) => onOpened()))
      ..add(_phone.briefingArrived.listen((_) => onArrived()))
      ..add(_phone.tokenChanges.listen(_registerIfAllowed));
    // Before the permission prompt, so that opening on Today doesn't wait for the Student's answer.
    if (await _phone.takeOpenedBriefing() && !_disposed) onOpened();
    await _registerIf(await _phone.askPermission());
  }

  /// The You tab's button. Android asks only until it's been told no twice, and then it's the phone's settings.
  Future<void> askAgain() async => _registerIf(await _phone.askPermission());

  /// The Student may have changed the phone's settings, or the backend may be back. What's already
  /// registered stays that way unless they've since said no, without troubling Firebase again.
  Future<void> check() async {
    if (status == PhoneNotificationStatus.checking || status == PhoneNotificationStatus.notInThisBuild) return;
    final allowed = await _phone.isAllowed();
    if (allowed && status == PhoneNotificationStatus.registered) return;
    await _registerIf(allowed);
  }

  Future<void> _registerIf(bool allowed) async {
    if (!allowed) {
      _setStatus(PhoneNotificationStatus.notAllowed);
      return;
    }
    final token = await _phone.token();
    if (token == null) {
      _setStatus(PhoneNotificationStatus.noToken);
      return;
    }
    await _register(token);
  }

  /// Firebase registers by itself, even with the permission prompt up or after a no. The backend hears nothing until it's allowed.
  Future<void> _registerIfAllowed(String token) async {
    if (await _phone.isAllowed()) await _register(token);
  }

  /// Firebase says the same token often, so that the backend is told once.
  Future<void> _register(String token) async {
    if (_disposed) return;
    if (token == _saved) {
      _setStatus(PhoneNotificationStatus.registered);
      return;
    }
    try {
      await _backend.savePushToken(token);
      _saved = token;
      _setStatus(PhoneNotificationStatus.registered);
    } on Exception {
      _setStatus(PhoneNotificationStatus.notRegistered);
    }
  }

  void _setStatus(PhoneNotificationStatus next) {
    if (_disposed) return;
    status = next;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final subscription in _listening) {
      subscription.cancel();
    }
    super.dispose();
  }
}
