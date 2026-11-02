import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';

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

  Widget _body() {
    final entries = _entries;
    if (_couldNotLoad) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Semantics(
            container: true,
            liveRegion: true,
            child: const Text("Buddy couldn't load your Activity. Check that the backend is running."),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(onPressed: _load, child: const Text('Try again')),
          ),
        ],
      );
    }
    if (entries == null) {
      return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading your Activity'));
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: entries.length + 1,
      itemBuilder: (context, index) {
        if (index > 0) return _EntryRow(entry: entries[index - 1]);
        return Text(
          entries.isEmpty
              ? "Nothing yet. What Buddy reads and does for you will show up here."
              : "Everything Buddy read and did for you, newest first. Entries can't be changed or removed one by one.",
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Activity')),
      body: SafeArea(child: _body()),
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

  String _when(BuildContext context) {
    final at = entry.at.toLocal();
    final localizations = MaterialLocalizations.of(context);
    return '${localizations.formatFullDate(at)} at ${localizations.formatTimeOfDay(TimeOfDay.fromDateTime(at))}';
  }

  void _openDecision(BuildContext context, ReplyDecision decision) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (context) => ReplyDecisionScreen(decision: decision)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final decision = entry.decision;
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // One item, because on Android its lines otherwise run together with the next entry.
          MergeSemantics(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.title, style: theme.textTheme.titleSmall),
                if (entry.detail case final detail?) Text(detail),
                // Cut short on the screen only. A screen reader still gets all of it.
                if (decision != null) Text(decision.reply, maxLines: 3, overflow: TextOverflow.ellipsis),
                Text(_when(context), style: theme.textTheme.bodySmall),
              ],
            ),
          ),
          if (decision != null)
            TextButton(
              onPressed: () => _openDecision(context, decision),
              // On its own, a Student using a screen reader would hear the same words for every reply.
              child: Text('How Buddy decided', semanticsLabel: 'How Buddy decided: ${_startOf(decision.reply)}'),
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
    return Scaffold(
      appBar: AppBar(title: const Text('How Buddy decided')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
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
        ),
      ),
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
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
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
