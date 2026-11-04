import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../spending/spending_section.dart';
import 'task_backend.dart';
import 'tasks_controller.dart';

const _couldNotReach = "The app couldn't reach Buddy. Check that the backend is running, then try again.";
const _couldNotOpen = "Your phone couldn't open that.";
const _stepsShown = 3;
const _mostSourcesShown = 8;

String _askingWords(Task task, String Function(int nanodollars) money) =>
    "This Task has cost ${money(task.spentNanodollars)} so far, and its next step could take it past ${money(task.allowanceNanodollars)}. "
    "It won't go on without your tap. If you tap Keep going, it may spend up to 1 dollar more, then it asks again.";

/// The icon for where a Task stands. The words beside it are always the backend's.
(IconData, Color) _lookOf(Task task) => switch (task.state) {
      'done' => (Icons.check_circle_outline, BuddyColors.good),
      'failed' => (Icons.error_outline, BuddyColors.problem),
      'cancelled' => (Icons.block, BuddyColors.inkSoft),
      'needs_student' => (Icons.pending_actions, BuddyColors.warningInk),
      _ => (Icons.schedule, BuddyColors.ink),
    };

/// A Task in a list: what it is and where it stands. Everything else is a tap away, on its own screen.
class TaskRow extends StatelessWidget {
  const TaskRow({super.key, required this.task, required this.onTap});

  final Task task;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _lookOf(task);
    return NavRow(
      icon: icon,
      iconColor: color,
      title: task.title,
      subtitle: task.stateText,
      semanticsLabel: 'Task: ${task.title}. ${task.stateText}',
      onTap: onTap,
    );
  }
}

/// A Task's progress, what it needs and what it found, in the conversation and on its own screen.
/// [task] is how it was when the card appeared, and the card follows the backend's changes from there.
class TaskCard extends StatefulWidget {
  const TaskCard({super.key, required this.task, required this.tasks, required this.openPhone, this.announce = false});

  final Task task;
  final TasksController tasks;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<TaskCard> createState() => _TaskCardState();
}

class _TaskCardState extends State<TaskCard> {
  String? _problem;
  String? _lastState;

  /// True once the state has changed with this card on the screen, so that a screen reader hears the card again.
  bool _stateChanged = false;

  Future<void> _tap(Future<void> Function() tap) async {
    setState(() => _problem = null);
    try {
      await tap();
    } on Exception {
      if (mounted) setState(() => _problem = _couldNotReach);
    }
  }

  Future<void> _open(TaskSource source) async {
    setState(() => _problem = null);
    final address = Uri.tryParse(source.url);
    bool opened;
    try {
      opened = address != null && await widget.openPhone(address);
    } on Exception {
      opened = false;
    }
    if (mounted && !opened) setState(() => _problem = _couldNotOpen);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.tasks,
      builder: (context, _) => _card(context, widget.tasks.byId(widget.task.id) ?? widget.task),
    );
  }

  Widget _card(BuildContext context, Task task) {
    final theme = Theme.of(context);
    final busy = widget.tasks.isBeingTapped(task);
    final shownSteps = task.steps.length > _stepsShown ? task.steps.sublist(task.steps.length - _stepsShown) : task.steps;
    if (_lastState != null && _lastState != task.state) _stateChanged = true;
    _lastState = task.state;
    final (icon, color) = _lookOf(task);
    // Holds nothing that changes while Buddy works, because each change to this is read out. The steps have their own stop.
    final aloud = [
      'Task: ${task.title}.',
      task.stateText,
      ...task.needs,
      if (task.askingToSpend) _askingWords(task, moneyAloud),
      ?task.problem,
      ?task.result,
      if (!task.isWorking) 'Cost so far: ${moneyAloud(task.spentNanodollars)}.',
    ].join('\n');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      // It holds several controls, so it's a set of separate nodes rather than one.
      child: Card(
        semanticContainer: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // One item, because on Android its lines otherwise run together with the buttons'.
              Semantics(
                container: true,
                liveRegion: widget.announce || _stateChanged,
                label: aloud,
                excludeSemantics: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(task.title, style: theme.textTheme.titleLarge),
                    const SizedBox(height: 6),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(icon, size: 22, color: color),
                        const SizedBox(width: 8),
                        Expanded(child: Text(task.stateText, style: theme.textTheme.titleSmall)),
                      ],
                    ),
                    for (final need in task.needs)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(need),
                      ),
                    if (task.askingToSpend)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_askingWords(task, moneyOnScreen)),
                      ),
                    if (task.problem case final problem?)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(problem),
                      ),
                    if (task.result case final result?)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(result),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('Cost so far: ${moneyOnScreen(task.spentNanodollars)}', style: theme.textTheme.bodySmall),
                    ),
                  ],
                ),
              ),
              if (task.isWorking) ...[
                const SizedBox(height: 10),
                const ExcludeSemantics(child: LinearProgressIndicator()),
              ],
              if (task.isWorking || task.state == 'needs_student')
                for (final step in shownSteps)
                  Semantics(
                    container: true,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(step, style: theme.textTheme.bodySmall),
                    ),
                  ),
              if (task.result != null || task.state == 'failed')
                for (final source in task.sources.take(_mostSourcesShown))
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton(
                      style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 8)),
                      onPressed: () => _open(source),
                      // Not called a Source, because only Buddy's code decides what counts as one, and it hasn't checked these.
                      child: Text('Buddy looked at: ${source.title}', semanticsLabel: 'Open a page Buddy looked at: ${source.title}'),
                    ),
                  ),
              if (_problem case final problem?) ProblemNote(problem),
              if (task.askingToSpend) ...[
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: busy ? null : () => _tap(() => widget.tasks.keepGoing(task)),
                  child: const Text('Keep going', semanticsLabel: 'Keep going, and let this Task spend up to 1 dollar more'),
                ),
              ],
              if (task.canCancel) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: busy ? null : () => _tap(() => widget.tasks.cancel(task)),
                  child: Text('Cancel', semanticsLabel: 'Cancel the Task: ${task.title}'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The screen a Task's row or its notification opens.
class TaskScreen extends StatelessWidget {
  const TaskScreen({super.key, required this.id, required this.tasks, required this.openPhone, this.openConversation});

  final int id;
  final TasksController tasks;
  final PhoneOpener openPhone;

  /// How to get to the conversation from here. With none, it's right behind this screen.
  final VoidCallback? openConversation;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: tasks,
      builder: (context, _) {
        final task = tasks.byId(id);
        return SubScreen(
          title: 'Your Task',
          children: [
            if (task == null)
              if (!tasks.hasLoaded && !tasks.couldNotLoad)
                const LoadingBlock(label: 'Loading your Task')
              else
                EmptyState(
                  isProblem: true,
                  words: tasks.couldNotLoad ? "The app can't reach Buddy right now. Check that the backend is running." : "Buddy can't find that Task.",
                )
            else ...[
              TaskCard(task: task, tasks: tasks, openPhone: openPhone),
              if (task.needs.isNotEmpty)
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: AppLink('Go to your conversation', onPressed: openConversation ?? () => Navigator.of(context).pop()),
                ),
            ],
          ],
        );
      },
    );
  }
}
