/// What the app needs from Firebase on the phone. Tests use a fake, and [NoPhoneNotifications] is what's
/// there until something better is plugged in.
abstract interface class PhoneNotifications {
  /// Whether this build of the app can use notifications at all. It can't without its Firebase config. Never throws.
  Future<bool> setUp();

  /// Whether a tap on a Briefing notification opened the app, or came before anything was listening. Says so once.
  Future<bool> takeOpenedBriefing();

  /// Android 13 and later show their own prompt the first time. Returns whether notifications are allowed.
  Future<bool> askPermission();

  Future<bool> isAllowed();

  /// Where Firebase can reach this phone: its Firebase Installation ID, which Buddy calls its push token. Null if
  /// Firebase won't say, as on an emulator without Google Play.
  Future<String?> token();

  Stream<String> get tokenChanges;

  /// The Student tapped a Briefing notification while the app was running.
  Stream<void> get briefingOpened;

  /// A Briefing arrived while the app was open, which the phone doesn't show by itself.
  Stream<void> get briefingArrived;
}

/// A build with no way to send notifications.
class NoPhoneNotifications implements PhoneNotifications {
  const NoPhoneNotifications();

  @override
  Future<bool> setUp() async => false;

  @override
  Future<bool> takeOpenedBriefing() async => false;

  @override
  Future<bool> askPermission() async => false;

  @override
  Future<bool> isAllowed() async => false;

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get tokenChanges => const Stream.empty();

  @override
  Stream<void> get briefingOpened => const Stream.empty();

  @override
  Stream<void> get briefingArrived => const Stream.empty();
}
