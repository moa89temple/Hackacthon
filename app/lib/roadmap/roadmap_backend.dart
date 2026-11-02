import '../backend/buddy_backend.dart';

/// Something the Student wants to achieve. They can have several.
class Goal {
  const Goal({required this.id, required this.text});

  factory Goal.fromJson(Map<String, dynamic> json) => Goal(id: json['id'] as int, text: json['text'] as String);

  final int id;
  final String text;
}

/// A Milestone on a card, before it's on the Roadmap. A Goal of null means it's a Standard Milestone.
class ProposedMilestone {
  const ProposedMilestone({
    required this.goal,
    required this.name,
    this.detail,
    required this.when,
    required this.sources,
    this.sourceNote,
    required this.calendarUrl,
  });

  factory ProposedMilestone.fromJson(Map<String, dynamic> json) => ProposedMilestone(
        goal: _goalIn(json),
        name: json['name'] as String,
        detail: json['detail'] as String?,
        when: json['when'] as String,
        sources: _sourcesIn(json),
        sourceNote: json['sourceNote'] as String?,
        calendarUrl: json['calendarUrl'] as String,
      );

  final Goal? goal;
  final String name;
  final String? detail;

  /// The due date in words.
  final String when;
  final List<GuidebookSource> sources;

  /// What to say in place of a Source, when there's none and why.
  final String? sourceNote;

  /// Google's own new-event page, which the Student looks at and saves themselves.
  final String calendarUrl;

  String get badge => switch (goal) {
        final Goal goal => 'Goal: ${goal.text}',
        null => 'Standard Milestone',
      };
}

Goal? _goalIn(Map<String, dynamic> json) => switch (json['goal']) {
      final Map<String, dynamic> goal => Goal.fromJson(goal),
      _ => null,
    };

List<GuidebookSource> _sourcesIn(Map<String, dynamic> json) => [
      for (final source in json['sources'] as List<dynamic>) GuidebookSource.fromJson(source as Map<String, dynamic>),
    ];

/// A Milestone on the Student's Roadmap.
class RoadmapMilestone extends ProposedMilestone {
  const RoadmapMilestone({
    required this.id,
    required this.done,
    this.goneFromSource = false,
    required super.goal,
    required super.name,
    super.detail,
    required super.when,
    required super.sources,
    super.sourceNote,
    required super.calendarUrl,
  });

  factory RoadmapMilestone.fromJson(Map<String, dynamic> json) => RoadmapMilestone(
        id: json['id'] as int,
        done: json['done'] as bool,
        goneFromSource: json['goneFromSource'] as bool? ?? false,
        goal: _goalIn(json),
        name: json['name'] as String,
        detail: json['detail'] as String?,
        when: json['when'] as String,
        sources: _sourcesIn(json),
        sourceNote: json['sourceNote'] as String?,
        calendarUrl: json['calendarUrl'] as String,
      );

  final int id;
  final bool done;

  /// A Standard Milestone whose date has left its Source, so this is what it last said.
  final bool goneFromSource;
}

/// One Milestone that accepting a card takes off the Roadmap.
class RemovedMilestone {
  const RemovedMilestone({required this.id, required this.name});

  factory RemovedMilestone.fromJson(Map<String, dynamic> json) => RemovedMilestone(id: json['id'] as int, name: json['name'] as String);

  final int id;
  final String name;
}

/// What the backend says became of a card.
enum RoadmapCardStatus { waiting, accepted, notNow, replaced, outOfDate }

/// Buddy's proposal for a Roadmap, or for a change to one, which nothing happens to until the Student taps it.
class RoadmapCard {
  const RoadmapCard({
    required this.id,
    required this.isFirst,
    required this.status,
    required this.why,
    this.note,
    required this.milestones,
    this.removes = const [],
  });

  factory RoadmapCard.fromJson(Map<String, dynamic> json) => RoadmapCard(
        id: json['id'] as int,
        isFirst: json['kind'] == 'first',
        status: switch (json['status']) {
          'waiting' => RoadmapCardStatus.waiting,
          'accepted' => RoadmapCardStatus.accepted,
          'not_now' => RoadmapCardStatus.notNow,
          'replaced' => RoadmapCardStatus.replaced,
          _ => RoadmapCardStatus.outOfDate,
        },
        why: json['why'] as String,
        note: json['note'] as String?,
        milestones: [
          for (final milestone in json['milestones'] as List<dynamic>) ProposedMilestone.fromJson(milestone as Map<String, dynamic>),
        ],
        removes: [
          for (final removed in json['removes'] as List<dynamic>) RemovedMilestone.fromJson(removed as Map<String, dynamic>),
        ],
      );

  final int id;
  final bool isFirst;
  final RoadmapCardStatus status;
  final String why;
  final String? note;
  final List<ProposedMilestone> milestones;
  final List<RemovedMilestone> removes;

  RoadmapCard withStatus(RoadmapCardStatus newStatus) =>
      RoadmapCard(id: id, isFirst: isFirst, status: newStatus, why: why, note: note, milestones: milestones, removes: removes);
}

/// What a tap on a card comes back as.
class RoadmapCardAnswer {
  const RoadmapCardAnswer({required this.card, required this.milestones});

  final RoadmapCard card;
  final List<RoadmapMilestone> milestones;
}

/// What the app needs from the backend for Goals and the Roadmap. Each throws if the backend can't
/// be reached or refuses, and then nothing has changed.
abstract interface class RoadmapBackend {
  Future<List<Goal>> loadGoals();
  Future<Goal> addGoal(String text);
  Future<Goal> editGoal(int id, String text);

  /// Returns the Roadmap as it stands, because the Goal's Milestones go with it.
  Future<List<RoadmapMilestone>> removeGoal(int id);

  /// In the Student's order.
  Future<List<RoadmapMilestone>> loadRoadmap();
  Future<RoadmapCardAnswer> acceptRoadmapCard(int id);
  Future<RoadmapCardAnswer> sayNotNowToRoadmapCard(int id);

  /// With no Goal it's a Standard Milestone. The date is written YYYY-MM-DD.
  Future<List<RoadmapMilestone>> addMilestone({required String name, required String dueDate, int? goalId});
  Future<List<RoadmapMilestone>> setMilestoneDone(int id, {required bool done});
  Future<List<RoadmapMilestone>> removeMilestone(int id);
  Future<List<RoadmapMilestone>> reorderMilestones(List<int> ids);
}

/// The calls themselves, for HttpBuddyBackend, which says how a call is made.
mixin HttpRoadmapCalls implements RoadmapBackend {
  /// Throws unless the backend said yes.
  Future<Map<String, dynamic>> roadmapCall(String method, String path, [Object? body]);

  List<RoadmapMilestone> _milestonesIn(Map<String, dynamic> json) => [
        for (final milestone in json['milestones'] as List<dynamic>) RoadmapMilestone.fromJson(milestone as Map<String, dynamic>),
      ];

  Future<RoadmapCardAnswer> _tap(int id, String what) async {
    final answer = await roadmapCall('POST', '/roadmap/cards/$id/$what');
    return RoadmapCardAnswer(card: RoadmapCard.fromJson(answer['card'] as Map<String, dynamic>), milestones: _milestonesIn(answer));
  }

  @override
  Future<List<Goal>> loadGoals() async => [
        for (final goal in (await roadmapCall('GET', '/goals'))['goals'] as List<dynamic>) Goal.fromJson(goal as Map<String, dynamic>),
      ];

  @override
  Future<Goal> addGoal(String text) async => Goal.fromJson((await roadmapCall('POST', '/goals', {'text': text}))['goal'] as Map<String, dynamic>);

  @override
  Future<Goal> editGoal(int id, String text) async =>
      Goal.fromJson((await roadmapCall('PATCH', '/goals/$id', {'text': text}))['goal'] as Map<String, dynamic>);

  @override
  Future<List<RoadmapMilestone>> removeGoal(int id) async => _milestonesIn(await roadmapCall('DELETE', '/goals/$id'));

  @override
  Future<List<RoadmapMilestone>> loadRoadmap() async => _milestonesIn(await roadmapCall('GET', '/roadmap'));

  @override
  Future<RoadmapCardAnswer> acceptRoadmapCard(int id) => _tap(id, 'accept');

  @override
  Future<RoadmapCardAnswer> sayNotNowToRoadmapCard(int id) => _tap(id, 'not-now');

  @override
  Future<List<RoadmapMilestone>> addMilestone({required String name, required String dueDate, int? goalId}) async =>
      _milestonesIn(await roadmapCall('POST', '/roadmap/milestones', {'name': name, 'dueDate': dueDate, 'goalId': goalId}));

  @override
  Future<List<RoadmapMilestone>> setMilestoneDone(int id, {required bool done}) async =>
      _milestonesIn(await roadmapCall('PATCH', '/roadmap/milestones/$id', {'done': done}));

  @override
  Future<List<RoadmapMilestone>> removeMilestone(int id) async => _milestonesIn(await roadmapCall('DELETE', '/roadmap/milestones/$id'));

  @override
  Future<List<RoadmapMilestone>> reorderMilestones(List<int> ids) async => _milestonesIn(await roadmapCall('PUT', '/roadmap/order', {'ids': ids}));
}
