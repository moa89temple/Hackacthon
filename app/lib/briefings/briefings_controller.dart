import 'package:flutter/foundation.dart';

import 'briefing_backend.dart';

const _couldNotReach = "The app couldn't reach Buddy, so nothing changed. Check that the backend is running, then try again.";

/// Lives as long as the app, like the Today tab it feeds and the You tab's times.
class BriefingsController extends ChangeNotifier {
  BriefingsController(this._backend);

  final BriefingBackend _backend;
  bool _disposed = false;

  /// Each load takes the next number, so that an older answer arriving late is ignored.
  int _latestLoad = 0;

  /// Null either before the first answer or when there's been no Briefing. [hasLoaded] tells them apart.
  Briefing? latest;
  bool hasLoaded = false;
  bool couldNotLoad = false;

  /// Null until the first answer, because the app mustn't claim a time it hasn't heard.
  BriefingSettings? settings;
  bool couldNotLoadSettings = false;

  /// Why the latest change of times didn't happen.
  String? problem;
  bool isChanging = false;

  /// Goes up each time the Student asks to see the Briefing, so that the Today tab can scroll back to it.
  int timesAskedToShow = 0;

  Future<void> load() async {
    final thisLoad = ++_latestLoad;
    couldNotLoad = false;
    couldNotLoadSettings = false;
    _changed();
    await Future.wait([_loadLatest(thisLoad), _loadSettings(thisLoad)]);
    if (thisLoad == _latestLoad) _changed();
  }

  Future<void> _loadLatest(int thisLoad) async {
    try {
      final loaded = await _backend.loadLatestBriefing();
      if (thisLoad != _latestLoad) return;
      latest = loaded;
      hasLoaded = true;
    } on Exception {
      if (thisLoad == _latestLoad) couldNotLoad = !hasLoaded;
    }
  }

  Future<void> _loadSettings(int thisLoad) async {
    try {
      final loaded = await _backend.loadBriefingSettings();
      if (thisLoad == _latestLoad) settings = loaded;
    } on Exception {
      if (thisLoad == _latestLoad) couldNotLoadSettings = settings == null;
    }
  }

  void askToShow() {
    timesAskedToShow++;
    _changed();
  }

  Future<void> saveTimes(BriefingTimes times) async {
    if (isChanging) return;
    isChanging = true;
    problem = null;
    _changed();
    try {
      settings = await _backend.saveBriefingTimes(times);
    } on Exception {
      problem = _couldNotReach;
    }
    isChanging = false;
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
