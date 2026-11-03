import 'package:flutter/material.dart';

import '../chat/crisis_card.dart';
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
}) {
  final theme = Theme.of(context);
  Widget heading(String words) => Semantics(header: true, child: Text(words, style: theme.textTheme.titleLarge));
  Widget note(String words, {bool isProblem = false}) => Padding(
        padding: const EdgeInsets.only(top: 4, bottom: 12),
        child: Semantics(container: true, liveRegion: isProblem, child: Text(words)),
      );

  final latest = briefings.latest;
  if (latest == null) {
    if (briefings.couldNotLoad) {
      return [
        note("Buddy couldn't load your Briefing. Check that the backend is running.", isProblem: true),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(onPressed: briefings.load, child: const Text('Try again', semanticsLabel: 'Try loading your Briefing again')),
        ),
      ];
    }
    final next = briefings.hasLoaded ? briefings.settings?.nextWhen : null;
    return [if (next != null) note('Your first Briefing comes $next.')];
  }

  if (latest.hadNothing) {
    return [
      heading(latest.title),
      note('Nothing needed you on ${latest.when}, so Buddy sent no notification.'),
    ];
  }
  if (latest.isEmpty) {
    return [
      heading(latest.title),
      note('What was in your Briefing from ${latest.when} has passed or been removed.'),
    ];
  }

  return [
    heading(latest.title),
    const SizedBox(height: 4),
    Text('From ${latest.when}'),
    const SizedBox(height: 6),
    for (final item in latest.milestones)
      MilestoneCard(
        key: ValueKey('briefing ${item.key}'),
        milestone: item.milestone,
        openPhone: openPhone,
        label: item.goal == null && item.sourceNote == null ? 'Standard Milestone' : 'Milestone',
        notes: [if (item.goal case final goal?) 'Goal: $goal', ?item.sourceNote],
      ),
    for (final opportunity in latest.opportunities)
      OpportunityCard(
        key: ValueKey('briefing opportunity ${opportunity.id}'),
        opportunity: opportunity,
        opportunities: opportunities,
        openPhone: openPhone,
      ),
    for (final news in latest.news) _NewsCard(key: ValueKey('briefing news ${news.id}'), news: news),
    for (final more in latest.moreNews)
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Text('And ${more.count} ${more.count == 1 ? 'other' : 'others'} from ${more.connection}.'),
      ),
    const SizedBox(height: 12),
  ];
}

/// Something new in a Connection, which is its own Source: it says which.
class _NewsCard extends StatelessWidget {
  const _NewsCard({super.key, required this.news});

  final BriefingNews news;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Semantics(
        container: true,
        label: 'From ${news.connection}: ${news.text}',
        excludeSemantics: true,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(news.text, style: Theme.of(context).textTheme.titleMedium),
              Padding(padding: const EdgeInsets.only(top: 4), child: Text('From ${news.connection}')),
            ],
          ),
        ),
      ),
    );
  }
}
