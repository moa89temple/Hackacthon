import 'package:flutter/foundation.dart';

import '../backend/buddy_backend.dart';

/// Lives as long as the app, because both the You tab and a card in the conversation show a
/// Connection, and each has to see what the other did.
class ConnectionsController extends ChangeNotifier {
  ConnectionsController(this._backend, {required this.onFactsChanged, required this.openTakeover});

  static const couldNotReach = "The app couldn't reach the backend. Check that it's running, then try again.";

  final BuddyBackend _backend;

  /// A read or a revoke changes which Profile facts there are.
  final VoidCallback onFactsChanged;

  /// Puts the live view on the screen. Finishes with the result of Done, or nothing if the Student left.
  final Future<FinishedTakeover?> Function(Takeover takeover) openTakeover;
  bool _disposed = false;

  /// Each load or change takes the next number, so that an older answer arriving late is ignored.
  int _latestWork = 0;

  /// Null until the first load has answered.
  List<Connection>? connections;
  bool couldNotLoad = false;

  /// The Connections being read right now.
  final Set<String> reading = {};

  /// The Connection a Takeover is under way for. Buddy stays out until the Student taps Done.
  String? takeoverSite;
  String? _takeoverSiteName;

  /// A Takeover is being opened, or is on the screen.
  bool openingLogin = false;

  /// What happened the last time the Student did something, for them to read.
  String? note;
  bool noteIsProblem = false;

  /// A service the Student has just asked for can appear on a card before it's on this list.
  final Set<String> _lookedFor = {};

  void lookFor(String id) {
    if (_lookedFor.add(id)) load();
  }

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
    await _checkForTakeover();
  }

  Future<void> _checkForTakeover() async {
    try {
      final takeover = await _backend.currentTakeover();
      takeoverSite = takeover?.site;
      _takeoverSiteName = takeover?.siteName;
      _changed();
    } on Exception {
      // Starting a Takeover returns any Takeover under way, so the button still works.
    }
  }

  /// Says which Takeover it is and where its Done is, because the screen with the Done on it has been left.
  String get _stillInControl {
    final name = _takeoverSiteName ?? 'another Connection';
    return "You're still in control of Buddy's Browser for $name, so Buddy can't read anything. On the You tab, tap Continue logging in to $name, then Done.";
  }

  /// The Student logging in through a Takeover. A login that worked gets read straight away.
  Future<void> logIn(Connection connection) async {
    openingLogin = true;
    note = null;
    _changed();

    final Takeover takeover;
    try {
      takeover = await _backend.startTakeover(connection.id);
    } on Exception {
      openingLogin = false;
      // Only one Takeover at a time, so the backend may be saying no because of another. The browser's fine then.
      await _checkForTakeover();
      if (_disposed) return;
      final blocking = takeoverSite != null && takeoverSite != connection.id;
      _setNote(
        blocking ? _stillInControl : "Buddy couldn't open its browser. Check that Buddy's Browser is running, then try again.",
        isProblem: true,
      );
      return;
    }

    final finished = await openTakeover(takeover);
    openingLogin = false;
    await _checkForTakeover();
    if (_disposed) return;
    if (finished == null) {
      // Leaving keeps it going, and nothing else would say that Buddy can't read anything until Done.
      if (takeoverSite != null) {
        _setNote(_stillInControl, isProblem: true);
      } else {
        _changed();
      }
      return;
    }
    if (!finished.signedIn) {
      _setNote(
        "Buddy couldn't confirm you're logged in to ${finished.siteName}. You can try logging in again.",
        isProblem: true,
      );
      return;
    }
    _setNote(
      switch (finished.title) {
        final String title => 'You\'re logged in to ${finished.siteName}. Buddy opened "$title" to check.',
        // With a connector, it's a login token that shows it worked, and Buddy opened nothing.
        _ => "You're logged in to ${finished.siteName}.",
      },
      isProblem: false,
    );
    await read(connection, sayWhenDone: false);
  }

  /// The row says what's happening anyway. Only the Student's own tap needs words of its own.
  Future<void> read(Connection connection, {bool sayWhenDone = true}) async {
    reading.add(connection.id);
    if (sayWhenDone) note = null;
    _changed();
    try {
      final updated = await _backend.readConnection(connection.id);
      _replace(updated);
      if (sayWhenDone) {
        // The usual words would leave the Student looking at this Connection, when what's in the way is another's Takeover.
        if (updated.lastReadProblem != null) await _checkForTakeover();
        if (_disposed) return;
        _setNote(
          updated.lastReadProblem == null
              ? 'Buddy read ${updated.name}.'
              : takeoverSite != null
                  ? _stillInControl
                  : "Buddy couldn't read ${updated.name}.",
          isProblem: updated.lastReadProblem != null,
        );
      }
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
    if (updated.needsLogin) {
      _setNote('${updated.name} is connected. Log in so that Buddy can read it.', isProblem: false);
    } else {
      _setNote(
        updated.lastReadProblem == null
            ? '${updated.name} is connected. Buddy read it just now.'
            : "${updated.name} is connected, but Buddy couldn't read it.",
        isProblem: updated.lastReadProblem != null,
      );
    }
    onFactsChanged();
  }

  Future<void> revoke(Connection connection) async {
    try {
      final updated = await _backend.revokeReadPermission(connection.id);
      _replace(updated);
      // A service the Student asked for goes from the list altogether, once nothing of it is left.
      if (connection.service != null && !updated.loginNotDeletedYet) await load();
      if (updated.loginNotDeletedYet) {
        _setNote(
          "Buddy can't read ${connection.name} any more, and deleted the facts it saved from it, but it couldn't delete your login yet. It will keep trying.",
          isProblem: true,
        );
      } else if (connection.service != null) {
        _setNote(
          "Buddy can't read ${connection.name} any more, deleted the facts it saved from it and anything it held to log in, and took it off your list.",
          isProblem: false,
        );
      } else {
        _setNote(
          connection.logsIn
              ? "Buddy can't read ${connection.name} any more, and deleted the facts it saved from it and your login."
              : "Buddy can't read ${connection.name} any more, and deleted the facts it saved from it.",
          isProblem: false,
        );
      }
      onFactsChanged();
    } on Exception {
      _setNote(couldNotReach, isProblem: true);
    }
  }

  /// A service the Student asked for and then didn't connect. Buddy holds nothing of theirs for it, so this asks no more.
  Future<void> remove(Connection connection) async {
    try {
      final updated = await _backend.revokeReadPermission(connection.id);
      _replace(updated);
      await load();
      _setNote('Buddy took ${connection.name} off your list.', isProblem: false);
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
