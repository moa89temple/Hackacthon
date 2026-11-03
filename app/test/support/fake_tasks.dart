import 'dart:async';

import 'package:buddy/tasks/task_backend.dart';

/// Stands in for the backend's Tasks. Made-up fixtures, only ever in tests.
mixin FakeTaskCalls implements TaskBackend {
  List<Task> tasks = [];
  Object? tasksError;
  Object? taskTapError;
  int taskLoads = 0;
  int taskListens = 0;
  final List<int> cancelled = [];
  final List<int> keptGoing = [];

  /// What each tap comes back as. By default, the Task as it was.
  Task? taskAfterTap;

  /// Holding it means the backend hasn't answered the tap yet.
  Completer<void>? holdTaskTap;

  StreamController<Task> taskChanges = StreamController<Task>.broadcast();

  /// A change arriving on the stream, as it does while the app is listening.
  void taskChanged(Task task) {
    tasks = [for (final old in tasks) old.id == task.id ? task : old, if (!tasks.any((old) => old.id == task.id)) task];
    taskChanges.add(task);
  }

  @override
  Future<List<Task>> loadTasks() async {
    taskLoads++;
    if (tasksError case final error?) throw error;
    return tasks;
  }

  @override
  Stream<Task> watchTasks() {
    taskListens++;
    return taskChanges.stream;
  }

  Future<Task> _tapped(int id) async {
    if (holdTaskTap case final hold?) await hold.future;
    if (taskTapError case final error?) throw error;
    return taskAfterTap ?? tasks.firstWhere((task) => task.id == id);
  }

  @override
  Future<Task> cancelTask(int id) async {
    final after = await _tapped(id);
    cancelled.add(id);
    return after;
  }

  @override
  Future<Task> keepTaskGoing(int id) async {
    final after = await _tapped(id);
    keptGoing.add(id);
    return after;
  }
}
