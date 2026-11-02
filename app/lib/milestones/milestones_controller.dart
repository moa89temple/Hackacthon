import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, like the Profile, so the Today tab keeps its place and its list while
/// the Student is on another tab.
class MilestonesController extends ChangeNotifier {
  MilestonesController(this._backend);

  final BuddyBackend _backend;
  bool _disposed = false;

  /// Each load takes the next number, so that an older answer arriving late is ignored.
  int _latestLoad = 0;

  /// Null until the first load has answered. Soonest first.
  List<StandardMilestone>? upcoming;
  bool couldNotLoad = false;

  Future<void> load() async {
    final thisLoad = ++_latestLoad;
    couldNotLoad = false;
    _changed();
    try {
      final loaded = await _backend.loadUpcomingMilestones();
      if (thisLoad != _latestLoad) return;
      upcoming = loaded;
    } on Exception {
      if (thisLoad != _latestLoad) return;
      couldNotLoad = upcoming == null;
    }
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
