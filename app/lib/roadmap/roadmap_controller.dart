import 'package:flutter/foundation.dart';

import 'roadmap_backend.dart';

const _nothingChanged = "The app couldn't reach Buddy, so nothing changed. Check that the backend is running, then try again.";

/// Lives as long as the app, so that the Goals and the Roadmap keep their place while the Student is
/// on another tab. Each change waits for the backend, so what's shown is always what's saved.
class RoadmapController extends ChangeNotifier {
  RoadmapController(this._backend);

  final RoadmapBackend _backend;
  bool _disposed = false;

  /// Each load takes the next number, so that an older answer arriving late is ignored.
  int _latestLoad = 0;

  /// Null until the first load has answered.
  List<Goal>? goals;

  /// Null until the first load has answered. In the Student's order.
  List<RoadmapMilestone>? milestones;
  bool couldNotLoad = false;

  /// Why the latest change didn't happen.
  String? problem;

  /// A change is on its way, and the controls wait for it, so that a second tap can't work from an old list.
  bool isChanging = false;

  /// Cards with a tap on its way, which can't take another until it's answered.
  final Set<int> _cardsBeingDecided = {};

  bool isBeingDecided(RoadmapCard card) => _cardsBeingDecided.contains(card.id);

  Future<void> load() async {
    final thisLoad = ++_latestLoad;
    couldNotLoad = false;
    _changed();
    try {
      final loadedGoals = await _backend.loadGoals();
      final loadedMilestones = await _backend.loadRoadmap();
      if (thisLoad != _latestLoad) return;
      goals = loadedGoals;
      milestones = loadedMilestones;
    } on Exception {
      if (thisLoad != _latestLoad) return;
      couldNotLoad = milestones == null;
    }
    _changed();
  }

  /// Runs one change. A load that started earlier may hold the old list, so it no longer counts.
  Future<void> _change(Future<void> Function() work) async {
    if (isChanging) return;
    isChanging = true;
    problem = null;
    _latestLoad++;
    _changed();
    try {
      await work();
    } on Exception {
      problem = _nothingChanged;
    }
    isChanging = false;
    _changed();
  }

  Future<void> addGoal(String text) => _change(() async {
        final goal = await _backend.addGoal(text);
        if (!(goals ?? const <Goal>[]).any((old) => old.id == goal.id)) goals = [...?goals, goal];
      });

  Future<void> editGoal(Goal goal, String text) => _change(() async {
        final edited = await _backend.editGoal(goal.id, text);
        goals = [for (final old in goals ?? const <Goal>[]) old.id == edited.id ? edited : old];
        // The edit has gone through by now, so a failure here isn't one to report. The next load catches up.
        try {
          milestones = await _backend.loadRoadmap();
        } on Exception {
          return;
        }
      });

  Future<void> removeGoal(Goal goal) => _change(() async {
        milestones = await _backend.removeGoal(goal.id);
        goals = (goals ?? const <Goal>[]).where((old) => old.id != goal.id).toList();
      });

  Future<void> addMilestone({required String name, required String dueDate, int? goalId}) =>
      _change(() async => milestones = await _backend.addMilestone(name: name, dueDate: dueDate, goalId: goalId));

  Future<void> setDone(RoadmapMilestone milestone, {required bool done}) =>
      _change(() async => milestones = await _backend.setMilestoneDone(milestone.id, done: done));

  Future<void> remove(RoadmapMilestone milestone) => _change(() async => milestones = await _backend.removeMilestone(milestone.id));

  /// Moves one place up or down the list. There's nowhere to go past either end.
  Future<void> move(RoadmapMilestone milestone, {required int by}) => _change(() async {
        final ids = [for (final existing in milestones ?? const <RoadmapMilestone>[]) existing.id];
        final from = ids.indexOf(milestone.id);
        final to = from + by;
        if (from < 0 || to < 0 || to >= ids.length) return;
        ids
          ..removeAt(from)
          ..insert(to, milestone.id);
        milestones = await _backend.reorderMilestones(ids);
      });

  /// The Student's one tap. Throws if the backend can't be reached, and then nothing has changed.
  Future<RoadmapCard?> accept(RoadmapCard card) => _decide(card, () => _backend.acceptRoadmapCard(card.id));

  /// Throws if the backend can't be reached, and then nothing has changed.
  Future<RoadmapCard?> notNow(RoadmapCard card) => _decide(card, () => _backend.sayNotNowToRoadmapCard(card.id));

  /// Null if a tap on this card is already on its way.
  Future<RoadmapCard?> _decide(RoadmapCard card, Future<RoadmapCardAnswer> Function() tap) async {
    if (!_cardsBeingDecided.add(card.id)) return null;
    _latestLoad++;
    _changed();
    try {
      final answer = await tap();
      milestones = answer.milestones;
      return answer.card;
    } finally {
      _cardsBeingDecided.remove(card.id);
      _changed();
    }
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
