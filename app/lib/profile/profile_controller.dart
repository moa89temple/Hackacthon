import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, like the conversation, so the You tab can show what Buddy saved
/// during a turn without being rebuilt.
class ProfileController extends ChangeNotifier {
  ProfileController(this._backend);

  static const _couldNotChange = "Buddy couldn't make that change. Check that the backend is running, then try again.";

  final BuddyBackend _backend;
  bool _disposed = false;

  /// Each load or change takes the next number, so that an older answer arriving late is ignored
  /// and can't bring back a fact the Student just deleted.
  int _latestWork = 0;

  /// Null until the first load has answered.
  List<ProfileFact>? facts;
  bool couldNotLoad = false;

  /// What happened the last time the Student changed something, for them to read.
  String? note;
  bool noteIsProblem = false;

  Future<void> load() async {
    final work = ++_latestWork;
    couldNotLoad = false;
    _changed();
    try {
      final loaded = await _backend.loadFacts();
      if (work != _latestWork) return;
      facts = loaded;
    } on Exception {
      if (work != _latestWork) return;
      couldNotLoad = facts == null;
    }
    _changed();
  }

  Future<void> edit(ProfileFact fact, String text) async {
    ++_latestWork;
    try {
      final edited = await _backend.editFact(fact.id, text);
      if (edited == null) {
        _setNote('That fact was already gone.', isProblem: false);
        await load();
        return;
      }
      facts = [
        for (final existing in facts ?? const <ProfileFact>[]) existing.id == fact.id ? edited.fact : existing,
      ];
      _setNote(edited.hiddenNote ?? 'Saved your change.', isProblem: false);
    } on Exception {
      _setNote(_couldNotChange, isProblem: true);
    }
  }

  Future<void> delete(ProfileFact fact) async {
    ++_latestWork;
    try {
      await _backend.deleteFact(fact.id);
      facts = [
        for (final existing in facts ?? const <ProfileFact>[])
          if (existing.id != fact.id) existing,
      ];
      _setNote('Deleted that fact.', isProblem: false);
    } on Exception {
      _setNote(_couldNotChange, isProblem: true);
    }
  }

  void _setNote(String text, {required bool isProblem}) {
    note = text;
    noteIsProblem = isProblem;
    _changed();
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
