import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';

/// What the Student can narrow the list to. An entry of a kind added later still shows under Everything.
enum _Filter {
  everything('Everything'),
  read('What Buddy read'),
  permissions('Permissions'),
  email('Emails'),
  replies('Replies');

  const _Filter(this.words);

  final String words;

  bool includes(ActivityEntry entry) {
    final kind = entry.kind;
    return switch (this) {
      _Filter.everything => true,
      _Filter.read => kind.startsWith('connection_read') || kind.startsWith('discovery') || kind == 'login_check',
      _Filter.permissions => kind.startsWith('read_permission') || kind.startsWith('action_'),
      _Filter.email => kind.startsWith('email_') || kind.startsWith('draft_') || kind == 'sending_mode_changed' || kind == 'own_address_saved',
      _Filter.replies => kind == 'reply' || kind == 'reply_failed',
    };
  }
}

IconData _iconFor(ActivityEntry entry) {
  final kind = entry.kind;
  if (kind.startsWith('connection_read') || kind.startsWith('discovery') || kind == 'login_check') return Icons.visibility_outlined;
  if (kind.startsWith('read_permission') || kind.startsWith('action_')) return Icons.verified_user_outlined;
  if (kind.startsWith('email_') || kind.startsWith('draft_') || kind == 'sending_mode_changed' || kind == 'own_address_saved') return Icons.mail_outline;
  if (kind == 'reply' || kind == 'reply_failed') return Icons.chat_bubble_outline;
  if (kind.startsWith('task_')) return Icons.schedule;
  if (kind.startsWith('briefing_')) return Icons.notifications_none;
  return Icons.circle_outlined;
}

/// The Student's record of everything Buddy read and did. It offers no way to change or remove an
/// entry, and it shows each one in the backend's own words, so later kinds of entry just appear.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.backend});

  final BuddyBackend backend;

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  /// Null until the first load has answered.
  List<ActivityEntry>? _entries;
  bool _couldNotLoad = false;
  _Filter _filter = _Filter.everything;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _couldNotLoad = false);
    try {
      final entries = await widget.backend.loadActivity();
      if (mounted) setState(() => _entries = entries);
    } on Exception {
      if (mounted) setState(() => _couldNotLoad = true);
    }
  }

  String _dayInWords(BuildContext context, DateTime day) {
    final today = DateUtils.dateOnly(DateTime.now());
    if (day == today) return 'Today';
    if (day == DateUtils.addDaysToDate(today, -1)) return 'Yesterday';
    return MaterialLocalizations.of(context).formatFullDate(day);
  }

  /// One day's entries together under its date, newest day first, because the list comes newest first.
  List<Widget> _byDay(BuildContext context, List<ActivityEntry> entries) {
    final days = <DateTime, List<ActivityEntry>>{};
    for (final entry in entries) {
      days.putIfAbsent(DateUtils.dateOnly(entry.at.toLocal()), () => []).add(entry);
    }
    return [
      for (final MapEntry(key: day, value: dayEntries) in days.entries) ...[
        const SizedBox(height: 20),
        GroupLabel(_dayInWords(context, day)),
        RowGroup(
          dividerIndent: 54,
          children: [for (final entry in dayEntries) _EntryRow(entry: entry)],
        ),
      ],
    ];
  }

  @override
  Widget build(BuildContext context) {
    final entries = _entries;
    final shown = entries?.where(_filter.includes).toList();
    return SubScreen(
      title: 'Activity',
      subtitle: entries == null || entries.isEmpty ? null : "Everything Buddy read and did for you, newest first. Entries can't be changed or removed one by one.",
      children: [
        if (_couldNotLoad)
          EmptyState(
            icon: Icons.bar_chart,
            isProblem: true,
            words: "Buddy couldn't load your Activity. Check that the backend is running.",
            action: AppLink('Try again', onPressed: _load),
          )
        else if (entries == null)
          const LoadingBlock(label: 'Loading your Activity')
        else if (entries.isEmpty)
          const EmptyState(icon: Icons.bar_chart, words: 'Nothing yet. What Buddy reads and does for you will show up here.')
        else ...[
          // Wraps, so that large text puts these on separate lines rather than off the screen. A chip can't wrap its
          // own words, so they only grow as far as a narrow phone has room for.
          MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.6,
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final filter in _Filter.values)
                  ChoiceChip(
                    label: Text(filter.words),
                    selected: _filter == filter,
                    labelStyle: Theme.of(context).textTheme.titleSmall?.copyWith(color: _filter == filter ? BuddyColors.cherry : BuddyColors.ink),
                    onSelected: (_) => setState(() => _filter = filter),
                  ),
              ],
            ),
          ),
          if (shown!.isEmpty)
            const EmptyState(words: 'Nothing of this kind yet.')
          else
            ..._byDay(context, shown),
        ],
      ],
    );
  }
}

/// The start of a reply, so that a screen reader can tell each button from the next.
String _startOf(String reply) {
  const longest = 40;
  if (reply.characters.length <= longest) return reply;
  final start = reply.characters.take(longest).toString();
  final lastSpace = start.lastIndexOf(' ');
  return '${lastSpace > 0 ? start.substring(0, lastSpace) : start}…';
}

class _EntryRow extends StatelessWidget {
  const _EntryRow({required this.entry});

  final ActivityEntry entry;

  void _openDecision(BuildContext context, ReplyDecision decision) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (context) => ReplyDecisionScreen(decision: decision)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final decision = entry.decision;
    final at = entry.at.toLocal();
    final localizations = MaterialLocalizations.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(child: Icon(_iconFor(entry), size: 22, color: BuddyColors.inkSoft)),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // One item, because on Android its lines otherwise run together with the next entry.
                MergeSemantics(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(entry.title, style: theme.textTheme.titleSmall),
                      if (entry.detail case final detail?) Padding(padding: const EdgeInsets.only(top: 2), child: Text(detail)),
                      // Cut short on the screen only. A screen reader still gets all of it.
                      if (decision != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(decision.reply, maxLines: 3, overflow: TextOverflow.ellipsis)),
                      Padding(
                        padding: const EdgeInsets.only(top: 2, bottom: 4),
                        child: Text(
                          localizations.formatTimeOfDay(TimeOfDay.fromDateTime(at)),
                          semanticsLabel: '${localizations.formatFullDate(at)} at ${localizations.formatTimeOfDay(TimeOfDay.fromDateTime(at))}',
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ),
                if (decision != null)
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                      onPressed: () => _openDecision(context, decision),
                      // On its own, a Student using a screen reader would hear the same words for every reply.
                      child: Text('How Buddy decided', semanticsLabel: 'How Buddy decided: ${_startOf(decision.reply)}'),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// What Buddy had to go on for one reply, as it was at the time.
class ReplyDecisionScreen extends StatelessWidget {
  const ReplyDecisionScreen({super.key, required this.decision});

  final ReplyDecision decision;

  @override
  Widget build(BuildContext context) {
    final bodySmall = Theme.of(context).textTheme.bodySmall;
    return SubScreen(
      title: 'How Buddy decided',
      children: [
        const _Heading('The reply', first: true),
        Text(decision.reply),
        const _Heading('What Buddy did, and the tools it used'),
        if (decision.tools.isEmpty) const Text('No tools for this reply.'),
        for (final tool in decision.tools) _Line(child: Text(tool)),
        const _Heading('Sources Buddy looked at'),
        if (decision.sources.isEmpty) const Text('No Sources for this reply.'),
        for (final source in decision.sources)
          _Line(
            child: MergeSemantics(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(source.title),
                  Text(source.url, style: bodySmall),
                ],
              ),
            ),
          ),
        const _Heading('Profile facts Buddy had'),
        if (decision.facts.isEmpty)
          const Text("Buddy wasn't given any Profile facts for this reply.")
        else
          const Text('Buddy had these in front of it when it wrote this reply, and may not have used every one.'),
        for (final fact in decision.facts)
          _Line(
            child: MergeSemantics(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(fact.text),
                  if (fact.detail case final detail?) Text(detail),
                  Text(fact.from, style: bodySmall),
                ],
              ),
            ),
          ),
        const SizedBox(height: 16),
        const Text('Buddy also had your conversation so far, including anything it looked at earlier in it.'),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text, {this.first = false});

  final String text;
  final bool first;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: first ? 0 : 24, bottom: 8),
      child: Semantics(
        header: true,
        child: Text(text, style: Theme.of(context).textTheme.titleLarge),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(padding: const EdgeInsets.only(top: 8), child: child);
  }
}
