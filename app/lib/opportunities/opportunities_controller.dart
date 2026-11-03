import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, because a saved Opportunity shows on the Today tab, on its own screen and on
/// any card in the conversation, and a tap on one should show on them all.
class OpportunitiesController extends ChangeNotifier {
  OpportunitiesController(this._backend);

  final BuddyBackend _backend;
  bool _disposed = false;

  /// Each load takes the next number, so that an older answer arriving late is ignored.
  int _latestLoad = 0;

  /// Null until the first load has answered. Temple's first, then those outside Temple, as the backend orders them.
  List<Opportunity>? all;
  bool couldNotLoad = false;

  /// What the Student has tapped since the last load, which a card elsewhere may not have heard about.
  final Map<int, bool> _tapped = {};
  final Set<int> _reported = {};

  /// A card in the conversation holds what was true when it arrived, so the latest load comes before that.
  bool isSaved(Opportunity opportunity) =>
      _tapped[opportunity.id] ?? all?.where((other) => other.id == opportunity.id).firstOrNull?.saved ?? opportunity.saved;
  bool wasReported(Opportunity opportunity) => _reported.contains(opportunity.id);

  List<Opportunity> get saved => [...?all?.where(isSaved)];

  Future<void> load() async {
    final thisLoad = ++_latestLoad;
    couldNotLoad = false;
    _changed();
    try {
      final loaded = await _backend.loadOpportunities();
      if (thisLoad != _latestLoad) return;
      all = loaded;
      _tapped.clear();
    } on Exception {
      if (thisLoad != _latestLoad) return;
      couldNotLoad = all == null;
    }
    _changed();
  }

  /// Shows at once. Throws if it didn't work, with the card back as it was.
  Future<void> setSaved(Opportunity opportunity, bool saved) async {
    final before = _tapped[opportunity.id];
    // An answer already on its way was asked before this tap, so it can't be allowed to undo it.
    _latestLoad++;
    _tapped[opportunity.id] = saved;
    _changed();
    try {
      await _backend.setOpportunitySaved(opportunity.id, saved);
    } on Exception {
      if (before == null) {
        _tapped.remove(opportunity.id);
      } else {
        _tapped[opportunity.id] = before;
      }
      _changed();
      rethrow;
    }
    await load();
  }

  /// Hides it for every Student. Throws if the Report didn't get there.
  Future<void> report(Opportunity opportunity) async {
    await _backend.reportOpportunity(opportunity.id);
    _reported.add(opportunity.id);
    all = all?.where((other) => other.id != opportunity.id).toList();
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
