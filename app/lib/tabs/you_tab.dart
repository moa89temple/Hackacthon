import 'package:flutter/material.dart';

import '../activity/activity_screen.dart';
import '../backend/buddy_backend.dart';
import '../briefings/briefings_controller.dart';
import '../briefings/briefings_section.dart';
import '../briefings/phone_notifications_controller.dart';
import '../chat/crisis_card.dart';
import '../connections/connections_controller.dart';
import '../connections/connections_section.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../profile/profile_controller.dart';
import '../profile/profile_section.dart';
import '../roadmap/goals_section.dart';
import '../roadmap/roadmap_controller.dart';
import '../sending/sending_controller.dart';
import '../sending/sending_section.dart';
import '../spending/spending_controller.dart';
import '../spending/spending_section.dart';

/// Everything about the Student and their controls, one screen deep. Each row says how that part stands, so that
/// most visits don't need to go any further.
class YouTab extends StatelessWidget {
  const YouTab({
    super.key,
    required this.backend,
    required this.profile,
    required this.connections,
    required this.roadmap,
    required this.sending,
    required this.spending,
    required this.briefings,
    required this.phoneNotifications,
    required this.openPhone,
    required this.askBuddy,
  });

  final BriefingsController briefings;
  final PhoneNotificationsController phoneNotifications;
  final BuddyBackend backend;
  final ProfileController profile;
  final ConnectionsController connections;
  final RoadmapController roadmap;
  final SendingController sending;
  final SpendingController spending;
  final PhoneOpener openPhone;
  final void Function(String words) askBuddy;

  void _open(BuildContext context, Widget Function(BuildContext context) screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: screen));
  }

  String? get _goalsLine => switch (roadmap.goals?.length) {
        null => null,
        0 => 'None yet',
        1 => '1 Goal',
        final count => '$count Goals',
      };

  Widget _connectionsRow(BuildContext context) {
    final list = connections.connections;
    final waiting = (list ?? const <Connection>[]).where((connection) => connection.needsLogin).toList();
    final hasProblem = waiting.isNotEmpty;
    final String? status;
    if (list == null) {
      status = null;
    } else if (waiting.length == 1) {
      status = '${waiting.first.name} needs login';
    } else if (waiting.length > 1) {
      status = '${waiting.length} need login';
    } else {
      final on = list.where((connection) => connection.on).length;
      status = on == 0 ? 'None on yet' : '$on of ${list.length} on';
    }
    return NavRow(
      icon: hasProblem ? Icons.warning_amber_rounded : Icons.link,
      iconColor: hasProblem ? BuddyColors.warningInk : null,
      title: 'Connections',
      subtitle: status,
      onTap: () => _open(context, (context) => ConnectionsScreen(connections: connections)),
    );
  }

  Widget _sendingRow(BuildContext context) {
    final isLive = sending.settings?.isLive;
    return NavRow(
      icon: Icons.mail_outline,
      title: 'Email Buddy sends',
      semanticsLabel: switch (isLive) {
        true => 'Email Buddy sends. Live is on',
        false => 'Email Buddy sends. Practice mode is on',
        null => 'Email Buddy sends',
      },
      below: switch (isLive) {
        true => const Align(alignment: AlignmentDirectional.centerStart, child: Pill('Live', tone: PillTone.solidCherry, icon: Icons.send)),
        false => const Align(alignment: AlignmentDirectional.centerStart, child: Pill('Practice mode')),
        null => null,
      },
      onTap: () => _open(context, (context) => SendingScreen(sending: sending)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([roadmap, connections, sending, briefings, spending]),
      builder: (context, _) => ListView(
        padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 16, BuddySizes.pageEdge, 24),
        children: [
          const PageTitle('You'),
          const SizedBox(height: 20),
          const GroupLabel('About you'),
          RowGroup(
            dividerIndent: 58,
            children: [
              NavRow(
                icon: Icons.track_changes,
                title: 'Your Goals',
                subtitle: _goalsLine,
                onTap: () => _open(context, (context) => GoalsScreen(roadmap: roadmap, askBuddy: askBuddy)),
              ),
              NavRow(
                icon: Icons.person_outline,
                title: 'Profile',
                subtitle: 'What Buddy knows about you',
                onTap: () => _open(context, (context) => ProfileScreen(profile: profile)),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const GroupLabel('What Buddy can do'),
          RowGroup(
            dividerIndent: 58,
            children: [
              _connectionsRow(context),
              NavRow(
                icon: Icons.notifications_none,
                title: 'Nudges',
                subtitle: switch (briefings.settings?.nextWhen) {
                  final next? => 'Next Briefing $next',
                  null => null,
                },
                onTap: () => _open(context, (context) => NudgesScreen(briefings: briefings, phone: phoneNotifications)),
              ),
              _sendingRow(context),
            ],
          ),
          const SizedBox(height: 24),
          const GroupLabel('History and controls'),
          RowGroup(
            dividerIndent: 58,
            children: [
              NavRow(
                icon: Icons.bar_chart,
                title: 'Activity',
                subtitle: 'What Buddy read and did',
                onTap: () => _open(context, (context) => ActivityScreen(backend: backend)),
              ),
              NavRow(
                icon: Icons.layers_outlined,
                title: 'What Buddy spent',
                subtitle: switch (spending.summary) {
                  final summary? => 'Today: ${moneyOnScreen(summary.todayNanodollars)}',
                  null => 'Usage and limits',
                },
                semanticsLabel: switch (spending.summary) {
                  final summary? => 'What Buddy spent. Today: ${moneyAloud(summary.todayNanodollars)}',
                  null => 'What Buddy spent. Usage and limits',
                },
                onTap: () => _open(context, (context) => SpendingScreen(spending: spending)),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const GroupLabel('Help'),
          RowGroup(
            children: [
              NavRow(
                icon: Icons.favorite_border,
                iconColor: BuddyColors.cherry,
                title: 'Need help right now?',
                subtitle: 'Reach a real person',
                onTap: () => _open(context, (context) => CrisisHelpScreen(openPhone: openPhone)),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            'Hackathon prototype, not an official Temple University service',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
