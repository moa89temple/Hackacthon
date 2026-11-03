import 'dart:convert';

import 'package:http/http.dart' as http;

/// A page a Task looked at.
class TaskSource {
  const TaskSource({required this.title, required this.url});

  factory TaskSource.fromJson(Map<String, dynamic> json) => TaskSource(title: json['title'] as String, url: json['url'] as String);

  final String title;
  final String url;
}

/// Work Buddy does in the background, as the backend describes it. The backend decides what each state means, and
/// the app shows its words as they are. Only the sentence asking to spend more is the app's, for how it reads money.
class Task {
  const Task({
    required this.id,
    required this.title,
    required this.state,
    required this.stateText,
    this.steps = const [],
    this.needs = const [],
    this.askingToSpend = false,
    this.result,
    this.problem,
    this.sources = const [],
    this.spentNanodollars = 0,
    this.allowanceNanodollars = 1000000000,
    this.canCancel = false,
    this.onToday = true,
  });

  factory Task.fromJson(Map<String, dynamic> json) => Task(
        id: json['id'] as int,
        title: json['title'] as String,
        state: json['state'] as String,
        stateText: json['stateText'] as String,
        steps: [for (final step in json['steps'] as List<dynamic>) step as String],
        needs: [for (final need in json['needs'] as List<dynamic>) need as String],
        askingToSpend: json['askingToSpend'] as bool,
        result: json['result'] as String?,
        problem: json['problem'] as String?,
        sources: [for (final source in json['sources'] as List<dynamic>) TaskSource.fromJson(source as Map<String, dynamic>)],
        spentNanodollars: json['spentNanodollars'] as int,
        allowanceNanodollars: json['allowanceNanodollars'] as int,
        canCancel: json['canCancel'] as bool,
        onToday: json['onToday'] as bool,
      );

  final int id;
  final String title;

  /// One of queued, working, needs_student, done, failed or cancelled.
  final String state;
  final String stateText;

  /// What Buddy has done so far, oldest first.
  final List<String> steps;

  /// What it's waiting for from the Student, each in a sentence.
  final List<String> needs;

  /// It paused over what it's cost, and only the Keep going tap lets it spend more.
  final bool askingToSpend;

  /// What it found.
  final String? result;

  /// Why it stopped, when it failed.
  final String? problem;
  final List<TaskSource> sources;
  final int spentNanodollars;
  final int allowanceNanodollars;
  final bool canCancel;
  final bool onToday;

  bool get isWorking => state == 'working' || state == 'queued';

  /// Something the Student should come and look at, which a notification also says.
  bool get wantsTheStudent => state == 'needs_student' || state == 'done' || state == 'failed';
}

/// What the app needs from the backend for Tasks. Cancel and Keep going come straight from the Student's taps.
abstract interface class TaskBackend {
  Future<List<Task>> loadTasks();

  /// Each change to any Task, as it happens, for as long as the connection lasts. It ends or fails when that drops.
  Stream<Task> watchTasks();

  /// Returns the Task as it is now. Throws if the backend can't be reached.
  Future<Task> cancelTask(int id);

  /// Returns the Task as it is now. Throws if the backend can't be reached.
  Future<Task> keepTaskGoing(int id);
}

/// The backend says something at least every 25 seconds, so this long with nothing means the connection has gone
/// without saying so, as it can when a phone changes networks.
const _silentForTooLong = Duration(seconds: 70);

mixin HttpTaskCalls implements TaskBackend {
  /// Throws unless the backend said yes.
  Future<Map<String, dynamic>> taskCall(String method, String path);

  /// Opens a request whose answer keeps coming. Throws unless the backend said yes.
  Future<http.StreamedResponse> taskStream(String path);

  @override
  Future<List<Task>> loadTasks() async =>
      [for (final task in (await taskCall('GET', '/tasks'))['tasks'] as List<dynamic>) Task.fromJson(task as Map<String, dynamic>)];

  @override
  Stream<Task> watchTasks() async* {
    final response = await taskStream('/tasks/events');
    final lines = response.stream.timeout(_silentForTooLong).transform(utf8.decoder).transform(const LineSplitter());
    await for (final line in lines) {
      if (!line.startsWith('data: ')) continue;
      final event = jsonDecode(line.substring(6)) as Map<String, dynamic>;
      if (event['type'] == 'task_update') yield Task.fromJson(event['task'] as Map<String, dynamic>);
    }
  }

  @override
  Future<Task> cancelTask(int id) async => Task.fromJson((await taskCall('POST', '/tasks/$id/cancel'))['task'] as Map<String, dynamic>);

  @override
  Future<Task> keepTaskGoing(int id) async => Task.fromJson((await taskCall('POST', '/tasks/$id/keep-going'))['task'] as Map<String, dynamic>);
}
