import 'dart:async';

import 'package:flutter/foundation.dart';

import 'task_backend.dart';

/// How long to wait before listening again when the connection to the backend drops.
const _listenAgainAfter = Duration(seconds: 5);

/// Lives as long as the app, so that a card shows the Task's progress on any tab. What it knows comes from the
/// backend's list, and from the stream of changes while the app can hear it.
class TasksController extends ChangeNotifier {
  TasksController(this._backend, {required this.onWantsTheStudent});

  final TaskBackend _backend;

  /// A Task has just reached a point the Student should look at, which may have left a card in the conversation.
  final void Function(Task task) onWantsTheStudent;

  final Map<int, Task> _tasks = {};
  final Set<int> _beingTapped = {};
  StreamSubscription<Task>? _listening;
  Timer? _listenAgain;
  bool _disposed = false;

  /// True once the first load has answered.
  bool hasLoaded = false;
  bool couldNotLoad = false;

  Task? byId(int id) => _tasks[id];

  /// Newest first, as the Today tab shows them.
  List<Task> get onToday => _tasks.values.where((task) => task.onToday).toList()..sort((a, b) => b.id.compareTo(a.id));

  bool isBeingTapped(Task task) => _beingTapped.contains(task.id);

  /// Starts listening, and catches up on whatever happened before that.
  void start() {
    _listen();
  }

  void _listen() {
    _listenAgain?.cancel();
    unawaited(_listening?.cancel());
    _listening = _backend.watchTasks().listen(_heard, onError: (Object _) => _dropped(), onDone: _dropped, cancelOnError: true);
    unawaited(load());
  }

  void _dropped() {
    if (_disposed) return;
    _listenAgain?.cancel();
    _listenAgain = Timer(_listenAgainAfter, _listen);
  }

  /// The phone may have stopped the connection while Buddy was in the background.
  void listenAgain() {
    if (!_disposed) _listen();
  }

  void _heard(Task task) {
    final before = _tasks[task.id];
    _tasks[task.id] = task;
    _changed();
    if (task.wantsTheStudent && before?.state != task.state) onWantsTheStudent(task);
  }

  Future<void> load() async {
    couldNotLoad = false;
    try {
      final loaded = await _backend.loadTasks();
      if (_disposed) return;
      final before = hasLoaded ? Map.of(_tasks) : null;
      _tasks
        ..clear()
        ..addEntries(loaded.map((task) => MapEntry(task.id, task)));
      hasLoaded = true;
      // What the stream missed, such as while the phone had Buddy in the background. The first load has nothing to
      // compare with, and the conversation is loading then anyway.
      if (before != null) {
        for (final task in loaded) {
          if (task.wantsTheStudent && before[task.id]?.state != task.state) onWantsTheStudent(task);
        }
      }
    } on Exception {
      // What's already here stays, because it's still the best anyone knows.
      couldNotLoad = !hasLoaded;
    }
    _changed();
  }

  /// Throws if the backend can't be reached, and then nothing changes.
  Future<void> cancel(Task task) => _tap(task, () => _backend.cancelTask(task.id));

  /// Throws if the backend can't be reached, and then nothing changes.
  Future<void> keepGoing(Task task) => _tap(task, () => _backend.keepTaskGoing(task.id));

  /// Only one tap at a time goes to the backend for a Task, however fast the Student taps.
  Future<void> _tap(Task task, Future<Task> Function() tap) async {
    if (!_beingTapped.add(task.id)) return;
    _changed();
    try {
      final after = await tap();
      _tasks[after.id] = after;
    } finally {
      _beingTapped.remove(task.id);
      _changed();
    }
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _listenAgain?.cancel();
    unawaited(_listening?.cancel());
    super.dispose();
  }
}
