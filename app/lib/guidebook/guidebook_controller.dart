import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, so that the Guidebook keeps its list between visits and can show it while it asks again.
class GuidebookController extends ChangeNotifier {
  GuidebookController(this._backend, {required this.report});

  final BuddyBackend _backend;

  /// Reports through the conversation, because every card of the item there has to go as well. Throws if it didn't get there.
  final Future<void> Function(GuidebookItem item) report;
  bool _disposed = false;

  /// Each load takes the next number, so that an older answer arriving late is ignored.
  int _latestLoad = 0;

  /// Null until the first load has answered. What costs nothing first, then by name.
  List<GuidebookItem>? items;
  bool couldNotLoad = false;

  List<GuidebookItem> get resources => [...?items?.where((item) => !item.isContact)];
  List<GuidebookItem> get contacts => [...?items?.where((item) => item.isContact)];

  Future<void> load() async {
    final thisLoad = ++_latestLoad;
    couldNotLoad = false;
    _changed();
    try {
      final loaded = await _backend.loadGuidebook();
      if (thisLoad != _latestLoad) return;
      items = loaded;
    } on Exception {
      if (thisLoad != _latestLoad) return;
      couldNotLoad = items == null;
    }
    _changed();
  }

  /// Hides it for every Student. Throws if the Report didn't get there, and then nothing changes.
  Future<void> reportItem(GuidebookItem item) async {
    await report(item);
    _latestLoad++;
    items = items?.where((other) => other.id != item.id).toList();
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
