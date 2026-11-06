import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../sending/sending_section.dart';
import 'chat_controller.dart';
import 'crisis_card.dart';

const _couldNotApprove =
    "The app couldn't reach Buddy, so it may or may not have started. It's safe to tap Approve again: Buddy won't do it twice.";
const _couldNotReach = "The app couldn't reach Buddy. Check that the backend is running, then try again.";
const _couldNotSwitch = "The app couldn't reach Buddy, so it may or may not have switched. Check in You > Email Buddy sends, then try again.";
const _needSomeoneNow = "Need someone right now? You don't have to wait for this email.";
const _couldNotCall = "Your phone couldn't open that. Dial 988 yourself, or use another phone if you can.";
const _modeLabels = {'Practice mode', 'Live'};
const _message = 'Message';
const _aiLine = 'Drafted with help from Buddy, an AI assistant';

/// Shows exactly what will happen, and asks for the Student's tap. What it says will happen comes from the
/// backend's own record of the card, never from what Claude wrote in the chat, and Approve is the only
/// thing in the app that can give an Action Permission. An email from the Crisis card also keeps 988 next
/// to it, in the app's own words.
class ActionCardView extends StatefulWidget {
  const ActionCardView({super.key, required this.card, required this.chat, required this.openPhone, required this.announce});

  final ActionCard card;
  final ChatController chat;
  final PhoneOpener openPhone;

  /// True when it has just appeared, so it should be read out.
  final bool announce;

  @override
  State<ActionCardView> createState() => _ActionCardViewState();
}

class _ActionCardViewState extends State<ActionCardView> {
  String? _problem;

  /// True once the Student has tapped here, so that what became of the tap is read out.
  bool _tapped = false;

  Future<void> _tap(Future<String?> Function() tap, String couldNotReach) async {
    setState(() {
      _tapped = true;
      _problem = null;
    });
    String? problem;
    try {
      problem = await tap();
    } on Exception {
      problem = couldNotReach;
    }
    if (mounted) setState(() => _problem = problem);
  }

  /// Asks first, as the You tab does. Live is the Student's to choose, and it makes a new card for them to approve.
  Future<void> _switchToLive() async {
    final card = widget.card;
    final yes = await askToSwitchToLive(
      context,
      goesTo: "whoever it's written to, including the person you chose",
      cardsStopping: 'Every card waiting for a tap stops working, Buddy makes a new one of this email for you to approve',
    );
    if (yes) await _tap(() => widget.chat.switchCardToLive(card), _couldNotSwitch);
  }

  /// The Crisis card may have scrolled out of view by now, and this must never stand between the Student and help.
  Future<void> _call988() async {
    bool opened;
    try {
      opened = await widget.openPhone(Uri.parse('tel:988'));
    } on Exception {
      opened = false;
    }
    if (mounted) setState(() => _problem = opened ? null : _couldNotCall);
  }

  /// The icon that goes with where the card stands. The words beside it are always the backend's.
  (IconData, Color, Color) get _statusLook => switch (widget.card.status) {
        'waiting' => (Icons.schedule, BuddyColors.ink, BuddyColors.surface),
        'running' => (Icons.sync, BuddyColors.ink, BuddyColors.surface),
        'done' => (Icons.check_circle_outline, BuddyColors.good, BuddyColors.goodTint),
        'unknown' => (Icons.warning_amber_rounded, BuddyColors.warningInk, BuddyColors.warningTint),
        _ => (Icons.block, BuddyColors.inkSoft, BuddyColors.surface),
      };

  Widget _messageBlock(ThemeData theme, String words) {
    // The line Buddy adds is set apart, so it's easy to spot and delete. The words themselves are exactly as they'll go.
    final endsWithAiLine = words.trimRight().endsWith(_aiLine);
    final body = endsWithAiLine ? words.trimRight().substring(0, words.trimRight().length - _aiLine.length).trimRight() : words;
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_message, style: theme.textTheme.titleSmall?.copyWith(color: BuddyColors.inkSoft)),
          const SizedBox(height: 4),
          Text(body),
          if (endsWithAiLine)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_aiLine, style: const TextStyle(fontStyle: FontStyle.italic, color: BuddyColors.inkSoft)),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final card = widget.card;
    final chat = widget.chat;
    final busy = chat.isBeingDecided(card);
    final lines = [for (final line in card.shows) '${line.label}: ${line.value}', ?card.note];
    final (statusIcon, statusColor, statusTint) = _statusLook;
    final mode = card.shows.where((line) => _modeLabels.contains(line.label)).firstOrNull;
    final isLive = mode?.label == 'Live';
    final details = card.shows.where((line) => !_modeLabels.contains(line.label)).toList();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: CardFrame(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // One item, because on Android its lines otherwise run together with the buttons'.
            Semantics(
              container: true,
              liveRegion: widget.announce,
              label: 'Action card: ${card.title}.\n${lines.join('\n')}',
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Only a card that's waiting for a tap asks for attention, with its square in solid cherry.
                  CardHeading(
                    icon: Icons.verified_user_outlined,
                    iconColor: card.canDecide ? Colors.white : BuddyColors.ink,
                    iconTint: card.canDecide ? BuddyColors.cherry : BuddyColors.cherryTint,
                    title: card.title,
                    titleStyle: theme.textTheme.headlineSmall,
                  ),
                  if (mode != null) ...[
                    const SizedBox(height: 12),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Pill(
                        mode.label,
                        tone: isLive ? PillTone.solidCherry : PillTone.cherry,
                        icon: isLive ? Icons.send : null,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(mode.value),
                  ],
                  const SizedBox(height: 14),
                  // Exactly what will happen, on white, set apart from what the card says about it.
                  InnerPanel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (final line in details)
                          if (line.label == _message) _messageBlock(theme, line.value) else LabelledLine(label: line.label, value: line.value),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Semantics(
              container: true,
              liveRegion: _tapped,
              // Not knowing is neither a success nor a failure, and the Student has something to check.
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: card.status == 'unknown' ? BuddyColors.warningTint : null,
                  borderRadius: BorderRadius.circular(BuddySizes.panelRadius),
                ),
                child: Padding(
                  padding: card.status == 'unknown' ? const EdgeInsets.all(12) : EdgeInsets.zero,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      IconTile(statusIcon, size: 34, color: statusColor, tint: card.status == 'unknown' ? BuddyColors.surface : statusTint),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 5),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(card.statusText, style: theme.textTheme.titleMedium),
                              if (card.outcome case final outcome?) Padding(padding: const EdgeInsets.only(top: 2), child: Text(outcome)),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (card.note case final note?)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: ExcludeSemantics(child: Text(note, style: theme.textTheme.bodySmall)),
              ),
            if (_problem case final problem?) ProblemNote(problem),
            if (card.canDecide) ...[
              const SizedBox(height: 16),
              // Stacked, because side by side they'd have no room on a small phone with large text.
              FilledButton(
                onPressed: busy ? null : () => _tap(() => chat.approve(card), _couldNotApprove),
                child: Text('Approve', semanticsLabel: 'Approve: ${card.title}'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: busy ? null : () => _tap(() => chat.decline(card), _couldNotReach),
                child: Text('Decline', semanticsLabel: 'Decline: ${card.title}'),
              ),
              if (card.offersLive) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: busy ? null : _switchToLive,
                  child: Text('Switch to Live', semanticsLabel: 'Switch to Live: ${card.title}'),
                ),
              ],
            ],
            if (card.isRunning) ...[
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => _tap(() async {
                  await chat.checkCard(card);
                  return null;
                }, _couldNotReach),
                child: Text('Check again', semanticsLabel: 'Check again: ${card.title}'),
              ),
            ],
            if (card.isCrisisEmail) ...[
              const SizedBox(height: 16),
              Semantics(container: true, child: Text(_needSomeoneNow, style: theme.textTheme.bodySmall)),
              const SizedBox(height: 6),
              FilledButton.icon(icon: const Icon(Icons.call), label: const Text('Call 988'), onPressed: _call988),
            ],
          ],
        ),
      ),
    );
  }
}
