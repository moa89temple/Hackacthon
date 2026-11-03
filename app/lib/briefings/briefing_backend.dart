import '../backend/buddy_backend.dart';

/// A Milestone in a Briefing. It reads like any other, plus what a Roadmap Milestone has besides.
class BriefingMilestone {
  const BriefingMilestone({required this.key, required this.milestone, this.goal, this.sourceNote});

  factory BriefingMilestone.fromJson(Map<String, dynamic> json) => BriefingMilestone(
        key: json['key'] as String,
        milestone: StandardMilestone.fromJson(json),
        goal: json['goal'] as String?,
        sourceNote: json['sourceNote'] as String?,
      );

  /// Tells apart a Roadmap Milestone and a Standard Milestone with the same id.
  final String key;
  final StandardMilestone milestone;

  /// The Goal it belongs to, if any.
  final String? goal;

  /// What to say in place of a Source, when there's none and why.
  final String? sourceNote;
}

/// Something new in a Connection.
class BriefingNews {
  const BriefingNews({required this.id, required this.connection, required this.text});

  factory BriefingNews.fromJson(Map<String, dynamic> json) =>
      BriefingNews(id: json['id'] as int, connection: json['connection'] as String, text: json['text'] as String);

  final int id;
  final String connection;
  final String text;
}

/// How much more a Connection has than the Briefing shows.
class MoreBriefingNews {
  const MoreBriefingNews({required this.connection, required this.count});

  factory MoreBriefingNews.fromJson(Map<String, dynamic> json) =>
      MoreBriefingNews(connection: json['connection'] as String, count: json['count'] as int);

  final String connection;
  final int count;
}

/// The latest Briefing, with each thing in it as it is now.
class Briefing {
  const Briefing({
    required this.title,
    required this.when,
    required this.milestones,
    required this.opportunities,
    required this.news,
    required this.moreNews,
    required this.hadNothing,
  });

  factory Briefing.fromJson(Map<String, dynamic> json) => Briefing(
        title: json['title'] as String,
        when: json['when'] as String,
        milestones: [for (final item in json['milestones'] as List<dynamic>) BriefingMilestone.fromJson(item as Map<String, dynamic>)],
        opportunities: [for (final item in json['opportunities'] as List<dynamic>) Opportunity.fromJson(item as Map<String, dynamic>)],
        news: [for (final item in json['news'] as List<dynamic>) BriefingNews.fromJson(item as Map<String, dynamic>)],
        moreNews: [for (final item in json['moreNews'] as List<dynamic>) MoreBriefingNews.fromJson(item as Map<String, dynamic>)],
        hadNothing: json['hadNothing'] as bool,
      );

  final String title;

  /// When Buddy made it, in words.
  final String when;
  final List<BriefingMilestone> milestones;
  final List<Opportunity> opportunities;
  final List<BriefingNews> news;
  final List<MoreBriefingNews> moreNews;

  /// Nothing was relevant when Buddy looked, so no notification went.
  final bool hadNothing;

  bool get isEmpty => milestones.isEmpty && opportunities.isEmpty && news.isEmpty;
}

/// Times of day on Philadelphia's clock, as HH:MM.
class BriefingTimes {
  const BriefingTimes({required this.weekdays, required this.sunday});

  final String weekdays;
  final String sunday;
}

class BriefingSettings {
  const BriefingSettings({required this.times, required this.nextWhen, required this.phoneNotificationsOn, required this.offBecause});

  factory BriefingSettings.fromJson(Map<String, dynamic> json) {
    final times = json['times'] as Map<String, dynamic>;
    final phone = json['phoneNotifications'] as Map<String, dynamic>;
    return BriefingSettings(
      times: BriefingTimes(weekdays: times['weekdays'] as String, sunday: times['sunday'] as String),
      nextWhen: (json['next'] as Map<String, dynamic>)['when'] as String,
      phoneNotificationsOn: phone['on'] as bool,
      offBecause: phone['offBecause'] as String?,
    );
  }

  final BriefingTimes times;

  /// When the next Briefing goes, in words.
  final String nextWhen;

  /// Whether the backend can send. The phone has its own say, which is PhoneNotificationStatus.
  final bool phoneNotificationsOn;
  final String? offBecause;
}

/// What the app needs from the backend for Briefings. Each of these comes from the app itself, never from Claude.
abstract interface class BriefingBackend {
  /// Null until there's been a Briefing.
  Future<Briefing?> loadLatestBriefing();

  Future<BriefingSettings> loadBriefingSettings();

  Future<BriefingSettings> saveBriefingTimes(BriefingTimes times);

  Future<void> savePushToken(String token);
}

mixin HttpBriefingCalls implements BriefingBackend {
  /// Throws unless the backend said yes. A yes with nothing to say comes back empty.
  Future<Map<String, dynamic>> briefingCall(String method, String path, [Object? body]);

  @override
  Future<Briefing?> loadLatestBriefing() async => switch ((await briefingCall('GET', '/briefings/latest'))['briefing']) {
        final Map<String, dynamic> briefing => Briefing.fromJson(briefing),
        _ => null,
      };

  @override
  Future<BriefingSettings> loadBriefingSettings() async => BriefingSettings.fromJson(await briefingCall('GET', '/briefings/settings'));

  @override
  Future<BriefingSettings> saveBriefingTimes(BriefingTimes times) async =>
      BriefingSettings.fromJson(await briefingCall('PUT', '/briefings/settings', {'weekdays': times.weekdays, 'sunday': times.sunday}));

  @override
  Future<void> savePushToken(String token) async {
    // In the body, because addresses end up in logs.
    await briefingCall('PUT', '/devices/push-token', {'token': token});
  }
}
