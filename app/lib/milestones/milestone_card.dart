import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../chat/crisis_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';

const _couldNotOpen = "Your phone couldn't open that.";

/// A Milestone with its date and Source, on the Today tab and in the conversation.
/// Everything on it comes from the backend's own record of the page, never from what Claude wrote.
class MilestoneCard extends StatefulWidget {
  const MilestoneCard({
    super.key,
    required this.milestone,
    required this.openPhone,
    this.announce = false,
    this.label = 'Standard Milestone',
    this.notes = const [],
    this.overline,
    this.action,
    this.inGroup = false,
  });

  final StandardMilestone milestone;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  /// What a screen reader calls it.
  final String label;

  /// More lines for one from the Roadmap, such as its Goal.
  final List<String> notes;

  /// The small capitals above its name, saying what kind of thing it is.
  final String? overline;

  /// A way on from here, such as to the Roadmap.
  final Widget? action;

  /// A row in a group, which has its own outline.
  final bool inGroup;

  @override
  State<MilestoneCard> createState() => _MilestoneCardState();
}

class _MilestoneCardState extends State<MilestoneCard> {
  String? _problem;

  Future<void> _open(Uri address) async {
    bool opened;
    try {
      opened = await widget.openPhone(address);
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _problem = opened ? null : _couldNotOpen);
  }

  @override
  Widget build(BuildContext context) {
    final milestone = widget.milestone;
    final theme = Theme.of(context);
    final lines = [
      milestone.when,
      ?milestone.term,
      if (milestone.passed) 'This date has passed.',
      ...widget.notes,
    ];
    final content = Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const IconTile(Icons.calendar_today_outlined),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // One item, because on Android its lines otherwise run together with the button's.
                Semantics(
                  container: true,
                  liveRegion: widget.announce,
                  label: '${widget.label}: ${milestone.name}. ${lines.map((line) => line.endsWith('.') ? line : '$line.').join(' ')}',
                  excludeSemantics: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (widget.overline case final overline?)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 2),
                          child: Text(overline.toUpperCase(), style: theme.textTheme.labelMedium),
                        ),
                      Text(milestone.name, style: theme.textTheme.titleMedium),
                      for (final (index, line) in lines.indexed)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          // The date first, in full, then what goes with it, quieter.
                          child: Text(line, style: index == 0 ? null : theme.textTheme.bodyMedium?.copyWith(color: BuddyColors.inkSoft)),
                        ),
                    ],
                  ),
                ),
                if (milestone.sources.isNotEmpty) const SizedBox(height: 2),
                SourceLinks(sources: milestone.sources, open: _open),
                if (_problem case final problem?) ProblemNote(problem),
                if (widget.action case final action?) Align(alignment: AlignmentDirectional.centerEnd, child: action),
              ],
            ),
          ),
        ],
      ),
    );
    if (widget.inGroup) return content;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: CardFrame(padding: EdgeInsets.zero, child: content),
    );
  }
}

/// In place of a card whose date isn't on its page any more.
class GoneMilestoneNote extends StatelessWidget {
  const GoneMilestoneNote({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          "Buddy no longer shows this date, because it's gone from its Source.",
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}
