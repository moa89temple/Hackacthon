import 'dart:async';

import 'package:buddy/briefings/briefing_backend.dart';
import 'package:buddy/briefings/phone_notifications.dart';

/// Stands in for the backend's Briefings. Made-up fixtures, only ever in tests.
mixin FakeBriefingCalls implements BriefingBackend {
  Briefing? latestBriefing;
  Object? latestBriefingError;
  int latestBriefingLoads = 0;

  BriefingSettings briefingSettings = const BriefingSettings(
    times: BriefingTimes(weekdays: '08:00', sunday: '18:00'),
    nextWhen: 'Wednesday, November 4 at 8:00 AM',
    phoneNotificationsOn: true,
    offBecause: null,
  );
  Object? briefingSettingsError;
  Object? saveTimesError;
  final List<BriefingTimes> timesSaved = [];

  final List<String> pushTokensSaved = [];
  Object? pushTokenError;

  @override
  Future<Briefing?> loadLatestBriefing() async {
    latestBriefingLoads++;
    if (latestBriefingError case final error?) throw error;
    return latestBriefing;
  }

  @override
  Future<BriefingSettings> loadBriefingSettings() async {
    if (briefingSettingsError case final error?) throw error;
    return briefingSettings;
  }

  @override
  Future<BriefingSettings> saveBriefingTimes(BriefingTimes times) async {
    if (saveTimesError case final error?) throw error;
    timesSaved.add(times);
    return briefingSettings = BriefingSettings(
      times: times,
      nextWhen: 'Wednesday, November 4 at ${times.weekdays}',
      phoneNotificationsOn: briefingSettings.phoneNotificationsOn,
      offBecause: briefingSettings.offBecause,
    );
  }

  @override
  Future<void> savePushToken(String token) async {
    if (pushTokenError case final error?) throw error;
    pushTokensSaved.add(token);
  }
}

/// Stands in for Firebase on the phone. A test decides what it answers, and when a notification comes.
class FakePhoneNotifications implements PhoneNotifications {
  FakePhoneNotifications({this.setUpWorks = true, this.allowed = true, this.currentToken = 'made-up-push-token', this.openedAtStart = false});

  bool setUpWorks;
  bool allowed;
  String? currentToken;
  bool openedAtStart;
  int permissionAsks = 0;
  int setUps = 0;

  final _opened = StreamController<void>.broadcast();
  final _arrived = StreamController<void>.broadcast();
  final _taskOpened = StreamController<int>.broadcast();

  /// The Task whose notification opened the app.
  int? taskOpenedAtStart;

  /// The Student tapping a Task's notification, with Buddy already running.
  void tapTaskNotification(int task) => _taskOpened.add(task);
  final _tokens = StreamController<String>.broadcast();

  /// The Student tapping a Briefing notification, with Buddy already running.
  void tapNotification() => _opened.add(null);

  /// A Briefing arriving while the Student has Buddy open.
  void briefingArrives() => _arrived.add(null);

  void tokenChangesTo(String token) => _tokens.add(token);

  @override
  Future<bool> setUp() async {
    setUps++;
    return setUpWorks;
  }

  @override
  Future<bool> takeOpenedBriefing() async {
    final opened = openedAtStart;
    openedAtStart = false;
    return opened;
  }

  @override
  Future<int?> takeOpenedTask() async {
    final opened = taskOpenedAtStart;
    taskOpenedAtStart = null;
    return opened;
  }

  @override
  Stream<int> get taskOpened => _taskOpened.stream;

  @override
  Future<bool> askPermission() async {
    permissionAsks++;
    return allowed;
  }

  @override
  Future<bool> isAllowed() async => allowed;

  @override
  Future<String?> token() async => currentToken;

  @override
  Stream<String> get tokenChanges => _tokens.stream;

  @override
  Stream<void> get briefingOpened => _opened.stream;

  @override
  Stream<void> get briefingArrived => _arrived.stream;
}
