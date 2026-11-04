import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../milestones/milestone_card.dart';
import '../opportunities/opportunities_controller.dart';
import '../opportunities/opportunity_card.dart';
import 'briefing_backend.dart';
import 'briefings_controller.dart';

/// The latest Briefing, as the first things in the Today tab's list. Everything in it comes from the backend's
/// own records, each with its Source, and nothing is written for the occasion.
List<Widget> briefingPart(
  BuildContext context, {
  required BriefingsController briefings,
  required OpportunitiesController opportunities,
  required PhoneOpener openPhone,
  required VoidCallback openRoadmap,
}) {
  final theme = Theme.of(context);
  Widget note(String words, {bool isProblem = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Semantics(container: true, liveRegion: isProblem, child: Text(words)),
      );

  final latest = briefings.latest;
  if (latest == null) {
    if (briefings.couldNotLoad) {
      return [
        note("Buddy couldn't load your Briefing. Check that the backend is running.", isProblem: true),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: AppLink('Try again', semanticsLabel: 'Try loading your Briefing again', onPressed: briefings.load),
        ),
      ];
    }
    final next = briefings.hasLoaded ? briefings.settings?.nextWhen : null;
    return [if (next != null) note('Your first Briefing comes $next.')];
  }

  if (latest.hadNothing) {
    return [
      SectionTitle(latest.title),
      note('Nothing needed you on ${latest.when}, so Buddy sent no notification.'),
    ];
  }
  if (latest.isEmpty) {
    return [
      SectionTitle(latest.title),
      note('What was in your Briefing from ${latest.when} has passed or been removed.'),
    ];
  }

  return [
    SectionTitle(latest.title, trailing: Text('From ${latest.when}', style: theme.textTheme.bodySmall)),
    RowGroup(
      children: [
        for (final item in latest.milestones)
          MilestoneCard(
            key: ValueKey('briefing ${item.key}'),
            milestone: item.milestone,
            openPhone: openPhone,
            inGroup: true,
            overline: item.key.startsWith('roadmap') ? 'Your Roadmap' : 'Standard Milestone',
            label: item.goal == null && item.sourceNote == null ? 'Standard Milestone' : 'Milestone',
            notes: [if (item.goal case final goal?) 'Goal: $goal', ?item.sourceNote],
            action: item.key.startsWith('roadmap')
                ? AppLink('View Roadmap', color: BuddyColors.cherry, semanticsLabel: 'View your Roadmap', onPressed: openRoadmap)
                : null,
          ),
        for (final opportunity in latest.opportunities)
          OpportunityCard(
            key: ValueKey('briefing opportunity ${opportunity.id}'),
            opportunity: opportunity,
            opportunities: opportunities,
            openPhone: openPhone,
            inGroup: true,
          ),
        for (final news in latest.news) _NewsRow(key: ValueKey('briefing news ${news.id}'), news: news),
        for (final more in latest.moreNews)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(more.words ?? 'And ${more.count} ${more.count == 1 ? 'other' : 'others'} from ${more.connection}.'),
          ),
      ],
    ),
    const SizedBox(height: 24),
  ];
}

/// Something new in a Connection. It came from the Student's own record there, not from a web page, so it says which Connection in place of a Source.
class _NewsRow extends StatelessWidget {
  const _NewsRow({super.key, required this.news});

  final BriefingNews news;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      label: 'From ${news.connection}: ${news.text}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.notifications_none, size: 26, color: BuddyColors.ink),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(news.text, style: text.titleMedium),
                  Padding(padding: const EdgeInsets.only(top: 2), child: Text('From ${news.connection}', style: text.bodySmall)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
