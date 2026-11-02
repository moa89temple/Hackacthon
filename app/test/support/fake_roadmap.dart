import 'dart:async';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/roadmap/roadmap_backend.dart';

/// Stands in for the backend's Goals and Roadmap. Made-up fixtures, only ever in tests.
mixin FakeRoadmapCalls implements RoadmapBackend {
  List<Goal> goals = [];
  List<RoadmapMilestone> milestones = [];
  Object? roadmapError;

  /// Makes every change fail, while loading still works.
  Object? roadmapChangeError;
  int roadmapLoads = 0;

  /// What accepting or saying not now comes back as, and what accepting puts on the Roadmap.
  RoadmapCardAnswer? answerToAccept;
  RoadmapCardAnswer? answerToNotNow;
  final List<int> accepted = [];
  final List<int> saidNotNow = [];
  final List<({String name, String dueDate, int? goalId})> added = [];
  final List<List<int>> orders = [];

  /// Set to hold a tap on a card open until a test completes it.
  Completer<void>? holdCardTap;

  /// Set to hold the next change's answer until a test completes it.
  Completer<void>? holdChange;

  /// Set to hold the next load's answer of the Roadmap until a test completes it.
  Completer<void>? holdRoadmapLoad;

  Future<void> _orThrow() async {
    if (holdChange case final hold?) {
      holdChange = null;
      await hold.future;
    }
    if (roadmapChangeError case final error?) throw error;
  }

  @override
  Future<List<Goal>> loadGoals() async {
    if (roadmapError case final error?) throw error;
    return goals;
  }

  @override
  Future<Goal> addGoal(String text) async {
    await _orThrow();
    final goal = Goal(id: goals.length + 100, text: text);
    goals = [...goals, goal];
    return goal;
  }

  @override
  Future<Goal> editGoal(int id, String text) async {
    await _orThrow();
    final goal = Goal(id: id, text: text);
    goals = [for (final old in goals) old.id == id ? goal : old];
    return goal;
  }

  @override
  Future<List<RoadmapMilestone>> removeGoal(int id) async {
    await _orThrow();
    goals = goals.where((goal) => goal.id != id).toList();
    milestones = milestones.where((milestone) => milestone.goal?.id != id).toList();
    return milestones;
  }

  @override
  Future<List<RoadmapMilestone>> loadRoadmap() async {
    roadmapLoads++;
    if (roadmapError case final error?) throw error;
    final asItWas = milestones;
    if (holdRoadmapLoad case final hold?) {
      holdRoadmapLoad = null;
      await hold.future;
    }
    return asItWas;
  }

  @override
  Future<RoadmapCardAnswer> acceptRoadmapCard(int id) async {
    accepted.add(id);
    if (holdCardTap case final hold?) await hold.future;
    await _orThrow();
    milestones = answerToAccept!.milestones;
    return answerToAccept!;
  }

  @override
  Future<RoadmapCardAnswer> sayNotNowToRoadmapCard(int id) async {
    saidNotNow.add(id);
    await _orThrow();
    return answerToNotNow!;
  }

  @override
  Future<List<RoadmapMilestone>> addMilestone({required String name, required String dueDate, int? goalId}) async {
    await _orThrow();
    added.add((name: name, dueDate: dueDate, goalId: goalId));
    milestones = [
      ...milestones,
      RoadmapMilestone(
        id: milestones.length + 1000,
        done: false,
        goal: goals.where((goal) => goal.id == goalId).firstOrNull,
        name: name,
        when: dueDate,
        sources: const [],
        sourceNote: 'You added this.',
        calendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
      ),
    ];
    return milestones;
  }

  @override
  Future<List<RoadmapMilestone>> setMilestoneDone(int id, {required bool done}) async {
    await _orThrow();
    milestones = [
      for (final old in milestones)
        old.id == id
            ? RoadmapMilestone(
                id: old.id,
                done: done,
                goal: old.goal,
                name: old.name,
                detail: old.detail,
                when: old.when,
                sources: old.sources,
                sourceNote: old.sourceNote,
                calendarUrl: old.calendarUrl,
              )
            : old,
    ];
    return milestones;
  }

  @override
  Future<List<RoadmapMilestone>> removeMilestone(int id) async {
    await _orThrow();
    milestones = milestones.where((milestone) => milestone.id != id).toList();
    return milestones;
  }

  @override
  Future<List<RoadmapMilestone>> reorderMilestones(List<int> ids) async {
    await _orThrow();
    orders.add(ids);
    milestones = [for (final id in ids) milestones.firstWhere((milestone) => milestone.id == id)];
    return milestones;
  }
}

const bulletinPage = 'https://bulletin.temple.edu/undergraduate/science-technology/biology-bs/';
const bulletinTitle = 'Biology BS | Temple University Bulletin';
const calendarLinkForTests = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Something&dates=20261207/20261208';
const paSchool = Goal(id: 1, text: 'Get into PA school');
final bulletinSource = GuidebookSource(url: bulletinPage, title: bulletinTitle, lastSeenAt: DateTime.utc(2026, 11, 2, 14));

RoadmapMilestone planTerm({int id = 1, String name = 'Finish your Year 2 Fall courses', bool done = false, Goal? goal = paSchool, String when = 'By the end of Fall 2026'}) =>
    RoadmapMilestone(
      id: id,
      done: done,
      goal: goal,
      name: name,
      detail: '16 credit hours:\nBIOL 2112 Introduction to Biology',
      when: when,
      sources: [bulletinSource],
      calendarUrl: calendarLinkForTests,
    );

RoadmapMilestone unwrittenRule({int id = 2, String name = 'Go to office hours in your first few weeks of class'}) => RoadmapMilestone(
      id: id,
      done: false,
      goal: null,
      name: name,
      when: 'Early in Spring 2027',
      sources: const [],
      sourceNote: 'General college advice from Buddy, not from a Temple page.',
      calendarUrl: calendarLinkForTests,
    );

RoadmapCard firstCard({
  int id = 5,
  RoadmapCardStatus status = RoadmapCardStatus.waiting,
  List<ProposedMilestone>? milestones,
  String? note = 'Uses the Suggested Academic Plan for Biology BS. Check it with your academic advisor.',
}) =>
    RoadmapCard(
      id: id,
      isFirst: true,
      status: status,
      why: 'This fits getting into PA school.',
      note: note,
      milestones: milestones ?? [planTerm(), unwrittenRule()],
    );

RoadmapCard changeCard({int id = 6, RoadmapCardStatus status = RoadmapCardStatus.waiting}) => RoadmapCard(
      id: id,
      isFirst: false,
      status: status,
      why: 'Since you want to shadow sooner.',
      milestones: [planTerm(name: 'Email a PA about shadowing', when: 'Sunday, December 20, 2026')],
      removes: const [RemovedMilestone(id: 1, name: 'Finish your Year 2 Fall courses')],
    );
