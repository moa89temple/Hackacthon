import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, because both the You tab and a card in the conversation show a
/// Connection, and each has to see what the other did.
class ConnectionsController extends ChangeNotifier {
  ConnectionsController(this._backend, {required this.onFactsChanged});

  static const couldNotReach = "The app couldn't reach the backend. Check that it's running, then try again.";

  final BuddyBackend _backend;

  /// A read or a revoke changes which Profile facts there are.
  final VoidCallback onFactsChanged;
  bool _disposed = false;

  /// Each load or change takes the next number, so that an older answer arriving late is ignored.
  int _latestWork = 0;

  /// Null until the first load has answered.
  List<Connection>? connections;
  bool couldNotLoad = false;

  /// The Connections being read right now.
  final Set<String> reading = {};

  /// What happened the last time the Student did something, for them to read.
  String? note;
  bool noteIsProblem = false;

  Connection? withId(String id) {
    for (final connection in connections ?? const <Connection>[]) {
      if (connection.id == id) return connection;
    }
    return null;
  }

  Future<void> load() async {
    final work = ++_latestWork;
    couldNotLoad = false;
    _changed();
    try {
      final loaded = await _backend.loadConnections();
      if (work != _latestWork) return;
      connections = loaded;
    } on Exception {
      if (work != _latestWork) return;
      couldNotLoad = connections == null;
    }
    _changed();
  }

  Future<void> read(Connection connection) async {
    reading.add(connection.id);
    note = null;
    _changed();
    try {
      final updated = await _backend.readConnection(connection.id);
      _replace(updated);
      _setNote(
        updated.lastReadProblem == null ? 'Buddy read ${updated.name}.' : "Buddy couldn't read ${updated.name}.",
        isProblem: updated.lastReadProblem != null,
      );
      onFactsChanged();
    } on Exception {
      _setNote(couldNotReach, isProblem: true);
    } finally {
      reading.remove(connection.id);
      _changed();
    }
  }

  /// The Student's tap on the card. Throws what the backend said, for the card to show.
  Future<void> give(Connection connection, String? address) async {
    final Connection updated;
    try {
      updated = await _backend.giveReadPermission(connection.id, address);
    } on Exception {
      // The backend may have saved it even if the answer never arrived, or it may have been given
      // already. Either way, what the Student sees should catch up.
      load();
      rethrow;
    }
    _replace(updated);
    _setNote(
      updated.lastReadProblem == null
          ? '${updated.name} is connected. Buddy read it just now.'
          : "${updated.name} is connected, but Buddy couldn't read it.",
      isProblem: updated.lastReadProblem != null,
    );
    onFactsChanged();
  }

  Future<void> revoke(Connection connection) async {
    try {
      _replace(await _backend.revokeReadPermission(connection.id));
      _setNote("Buddy can't read ${connection.name} any more, and deleted the facts it saved from it.", isProblem: false);
      onFactsChanged();
    } on Exception {
      _setNote(couldNotReach, isProblem: true);
    }
  }

  void _replace(Connection updated) {
    ++_latestWork;
    connections = [
      for (final existing in connections ?? const <Connection>[]) existing.id == updated.id ? updated : existing,
    ];
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
