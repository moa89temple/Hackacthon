import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'phone_notifications.dart';

const _briefingType = 'briefing';
const _registerTimeout = Duration(seconds: 30);

/// Notifications through Firebase Cloud Messaging. It reads its project from google-services.json, which is
/// built into the app only when it's there. Without it the app still runs, and [setUp] says no.
class FirebasePhoneNotifications implements PhoneNotifications {
  final _opened = StreamController<void>.broadcast();
  final _arrived = StreamController<void>.broadcast();
  final _registered = StreamController<String>.broadcast();
  String? _lastRegistered;
  Future<bool>? _setUp;

  /// A tap can come while the app is still locked, before anything is listening.
  bool _tappedWithNoOneListening = false;
  bool _initialMessageTaken = false;

  bool _isBriefing(RemoteMessage? message) => message?.data['type'] == _briefingType;

  @override
  Future<bool> setUp() => _setUp ??= _start();

  Future<bool> _start() async {
    try {
      await Firebase.initializeApp();
      // Listening first, as Firebase asks, because it can register by itself as soon as it starts.
      FirebaseMessaging.instance.onRegistered.listen((id) {
        _lastRegistered = id;
        _registered.add(id);
      });
      FirebaseMessaging.onMessageOpenedApp.listen((message) {
        if (!_isBriefing(message)) return;
        if (_opened.hasListener) {
          _opened.add(null);
        } else {
          _tappedWithNoOneListening = true;
        }
      });
      FirebaseMessaging.onMessage.listen((message) {
        if (_isBriefing(message)) _arrived.add(null);
      });
      return true;
    } on Object catch (error) {
      debugPrint("Phone notifications aren't set up in this build of the app: $error");
      return false;
    }
  }

  @override
  Future<bool> takeOpenedBriefing() async {
    if (!await setUp()) return false;
    final tapped = _tappedWithNoOneListening;
    _tappedWithNoOneListening = false;
    if (_initialMessageTaken) return tapped;
    _initialMessageTaken = true;
    try {
      return tapped || _isBriefing(await FirebaseMessaging.instance.getInitialMessage());
    } on Object {
      return tapped;
    }
  }

  bool _allows(NotificationSettings settings) =>
      settings.authorizationStatus == AuthorizationStatus.authorized || settings.authorizationStatus == AuthorizationStatus.provisional;

  @override
  Future<bool> askPermission() async {
    try {
      return _allows(await FirebaseMessaging.instance.requestPermission());
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> isAllowed() async {
    try {
      return _allows(await FirebaseMessaging.instance.getNotificationSettings());
    } on Object {
      return false;
    }
  }

  /// Firebase answers register() on its own stream, each time, and also on its own schedule.
  @override
  Future<String?> token() async {
    try {
      final next = _registered.stream.first;
      await FirebaseMessaging.instance.register();
      return await next.timeout(_registerTimeout);
    } on Object {
      return _lastRegistered;
    }
  }

  @override
  Stream<String> get tokenChanges => _registered.stream;

  @override
  Stream<void> get briefingOpened => _opened.stream;

  @override
  Stream<void> get briefingArrived => _arrived.stream;
}
