import 'package:flutter/material.dart';

import '../design/parts.dart';
import '../design/theme.dart';
import 'roadmap_backend.dart';
import 'roadmap_controller.dart';

/// Putting the Roadmap in the Student's own order. A Milestone can be dragged by its handle or moved with its arrows,
/// because dragging isn't something everyone can do.
class OrganizeScreen extends StatelessWidget {
  const OrganizeScreen({super.key, required this.roadmap});

  final RoadmapController roadmap;

  Future<void> _remove(BuildContext context, RoadmapMilestone milestone) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Remove this Milestone?'),
        content: Text(milestone.name),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: BuddyColors.problem),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) await roadmap.remove(milestone);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: roadmap,
      builder: (context, _) {
        final milestones = roadmap.milestones ?? const <RoadmapMilestone>[];
        final text = Theme.of(context).textTheme;
        final busy = roadmap.isChanging;
        return Scaffold(
          appBar: backBar(),
          body: SafeArea(
            top: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Above the list, so that it's seen and read out from however far down the Student has scrolled.
                // With large text it can't take the whole screen, so it scrolls in its own third.
                if (roadmap.problem case final problem?)
                  Flexible(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.symmetric(horizontal: BuddySizes.pageEdge),
                      child: ProblemNote(problem),
                    ),
                  ),
                Expanded(
                  flex: 2,
                  child: ReorderableListView.builder(
                    padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 4, BuddySizes.pageEdge, 24),
                    header: const Padding(
                      padding: EdgeInsets.only(bottom: 16),
                      child: PageTitle('Organize', subtitle: 'Drag a Milestone by its handle, or use the arrows.', isTab: false),
                    ),
                    buildDefaultDragHandles: false,
                    itemCount: milestones.length,
                    onReorderItem: (from, to) {
                      if (!busy && from != to) roadmap.move(milestones[from], by: to - from);
                    },
                    itemBuilder: (context, index) {
                      final milestone = milestones[index];
                      final name = milestone.name;
                      return Padding(
                        key: ValueKey(milestone.id),
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Material(
                          color: BuddyColors.frame,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.cardRadius)),
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(4, 8, 4, 4),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    ReorderableDragStartListener(
                                      index: index,
                                      child: const SizedBox.square(
                                        dimension: BuddySizes.tapTarget,
                                        child: ExcludeSemantics(child: Icon(Icons.drag_indicator, color: BuddyColors.inkSoft)),
                                      ),
                                    ),
                                    Expanded(
                                      child: Padding(
                                        padding: const EdgeInsets.only(top: 4, right: 8),
                                        child: Semantics(
                                          container: true,
                                          label: 'Milestone ${index + 1} of ${milestones.length}: $name. ${milestone.when}.${milestone.done ? ' Done.' : ''}',
                                          excludeSemantics: true,
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(name, style: text.titleMedium?.copyWith(decoration: milestone.done ? TextDecoration.lineThrough : null)),
                                              Text(milestone.when, style: text.bodySmall),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                // Wraps, so that large text never pushes one off the card.
                                Wrap(
                                  alignment: WrapAlignment.end,
                                  children: [
                                    IconButton(icon: const Icon(Icons.arrow_upward), tooltip: 'Move up: $name', onPressed: busy || index == 0 ? null : () => roadmap.move(milestone, by: -1)),
                                    IconButton(
                                      icon: const Icon(Icons.arrow_downward),
                                      tooltip: 'Move down: $name',
                                      onPressed: busy || index == milestones.length - 1 ? null : () => roadmap.move(milestone, by: 1),
                                    ),
                                    IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Remove: $name', onPressed: busy ? null : () => _remove(context, milestone)),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
