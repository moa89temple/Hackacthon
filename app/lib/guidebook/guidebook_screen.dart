import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import '../chat/crisis_card.dart';
import '../chat/guidebook_card.dart';
import '../design/parts.dart';
import '../design/theme.dart';
import '../opportunities/opportunities_controller.dart';
import '../opportunities/opportunity_card.dart';
import 'guidebook_controller.dart';

const _shownAtATime = 10;
const _couldNotOpen = "Your phone couldn't open that.";

enum GuidebookShelf {
  resources('Resources'),
  opportunities('Opportunities'),
  contacts('Contacts');

  const GuidebookShelf(this.words);

  final String words;
}

/// Opens the Guidebook on one of its shelves, with what's on them read again.
void openGuidebook(
  BuildContext context, {
  required GuidebookController guidebook,
  required OpportunitiesController opportunities,
  required PhoneOpener openPhone,
  required void Function(String words) askBuddy,
  GuidebookShelf shelf = GuidebookShelf.resources,
}) {
  guidebook.load();
  opportunities.load();
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (context) => GuidebookScreen(guidebook: guidebook, opportunities: opportunities, openPhone: openPhone, askBuddy: askBuddy, shelf: shelf),
    ),
  );
}

/// Everything Buddy has discovered, for a Student who wants to look around rather than work out what to ask.
class GuidebookScreen extends StatefulWidget {
  const GuidebookScreen({
    super.key,
    required this.guidebook,
    required this.opportunities,
    required this.openPhone,
    required this.askBuddy,
    this.shelf = GuidebookShelf.resources,
  });

  final GuidebookController guidebook;
  final OpportunitiesController opportunities;
  final PhoneOpener openPhone;
  final void Function(String words) askBuddy;
  final GuidebookShelf shelf;

  @override
  State<GuidebookScreen> createState() => _GuidebookScreenState();
}

class _GuidebookScreenState extends State<GuidebookScreen> {
  late GuidebookShelf _shelf = widget.shelf;
  final _search = TextEditingController();
  int _shown = _shownAtATime;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<String> get _searchWords => _search.text.toLowerCase().split(RegExp(r'\s+')).where((word) => word.isNotEmpty).toList();

  bool _matches(List<String?> fields) {
    final words = _searchWords;
    if (words.isEmpty) return true;
    final haystack = fields.whereType<String>().join(' ').toLowerCase();
    return words.every(haystack.contains);
  }

  List<GuidebookItem> _itemsFrom(List<GuidebookItem> items) =>
      items.where((item) => _matches([item.name, item.summary, item.place])).toList();

  List<Opportunity> get _opportunities => [
        ...?widget.opportunities.all?.where((opportunity) => _matches([opportunity.name, opportunity.summary, opportunity.place, ...opportunity.forGoals])),
      ];

  int? _countOn(GuidebookShelf shelf) => switch (shelf) {
        GuidebookShelf.resources => widget.guidebook.items == null ? null : _itemsFrom(widget.guidebook.resources).length,
        GuidebookShelf.contacts => widget.guidebook.items == null ? null : _itemsFrom(widget.guidebook.contacts).length,
        GuidebookShelf.opportunities => widget.opportunities.all == null ? null : _opportunities.length,
      };

  Widget _message(String words, {Widget? action, bool isProblem = false}) =>
      EmptyState(icon: Icons.menu_book_outlined, words: words, isProblem: isProblem, action: action);

  List<Widget> _itemsShelf(List<GuidebookItem> items, {required String nothingYet}) {
    final guidebook = widget.guidebook;
    if (guidebook.couldNotLoad) {
      return [
        _message(
          "Buddy couldn't load the Guidebook. Check that the backend is running.",
          isProblem: true,
          action: AppLink('Try again', onPressed: guidebook.load),
        ),
      ];
    }
    if (guidebook.items == null) return const [LoadingBlock(label: 'Loading the Guidebook')];
    final found = _itemsFrom(items);
    if (found.isEmpty) return [_message(_searchWords.isEmpty ? nothingYet : _nothingMatches)];
    return [
      RowGroup(
        dividerIndent: RowGroup.indentPastIcon,
        children: [
          for (final item in found)
            _ItemRow(
              key: ValueKey('guidebook ${item.id}'),
              item: item,
              openPhone: widget.openPhone,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (context) => GuidebookItemScreen(
                    item: item,
                    openPhone: widget.openPhone,
                    report: widget.guidebook.reportItem,
                    askBuddy: widget.askBuddy,
                  ),
                ),
              ),
            ),
        ],
      ),
    ];
  }

  String get _nothingMatches => "Nothing here matches that. Try other words, or ask Buddy.";

  Widget _opportunityGroup(List<Opportunity> opportunities) => RowGroup(
        dividerIndent: RowGroup.indentPastIcon,
        children: [
          for (final opportunity in opportunities)
            OpportunityCard(
              // Keeps each card's state with its own Opportunity as the list changes around it.
              key: ValueKey(opportunity.id),
              opportunity: opportunity,
              opportunities: widget.opportunities,
              openPhone: widget.openPhone,
              inGroup: true,
            ),
        ],
      );

  List<Widget> _opportunitiesShelf() {
    final controller = widget.opportunities;
    if (controller.couldNotLoad) {
      return [
        _message(
          "Buddy couldn't load these. Check that the backend is running.",
          isProblem: true,
          action: AppLink('Try again', onPressed: controller.load),
        ),
      ];
    }
    if (controller.all == null) return const [LoadingBlock(label: 'Loading Opportunities')];
    final all = _opportunities;
    if (all.isEmpty) {
      return [
        _message(
          _searchWords.isEmpty
              ? "Nothing to show yet. Buddy reads Temple's events each day, and searches for what fits your Goals when they change and once a week."
              : _nothingMatches,
        ),
      ];
    }
    final shown = all.take(_shown).toList();
    final atTemple = shown.where((opportunity) => !opportunity.outsideTemple).toList();
    final outside = shown.where((opportunity) => opportunity.outsideTemple).toList();
    final more = all.length - shown.length;
    final nextBatch = more < _shownAtATime ? more : _shownAtATime;
    return [
      if (atTemple.isNotEmpty) ...[
        const SectionTitle('At Temple'),
        _opportunityGroup(atTemple),
        const SizedBox(height: 20),
      ],
      if (outside.isNotEmpty) ...[
        const SectionTitle(outsideTempleLabel),
        const Text("These aren't Temple's own, so check each one's Source before you sign up."),
        const SizedBox(height: 12),
        _opportunityGroup(outside),
      ],
      if (more > 0)
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: AppLink(
            'Show $nextBatch more',
            semanticsLabel: 'Show $nextBatch more ${nextBatch == 1 ? 'Opportunity' : 'Opportunities'}',
            onPressed: () => setState(() => _shown += _shownAtATime),
          ),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([widget.guidebook, widget.opportunities, _search]),
      builder: (context, _) => SubScreen(
        title: 'Guidebook',
        subtitle: 'What Buddy has found for you, each with the page it came from.',
        children: [
          TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              hintText: 'Search the Guidebook',
              prefixIcon: Icon(Icons.search),
            ),
          ),
          const SizedBox(height: 12),
          // Wraps, so that large text puts these on separate lines rather than off the screen. A chip can't wrap its
          // own words, so they only grow as far as a narrow phone has room for.
          MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.6,
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final shelf in GuidebookShelf.values)
                  ChoiceChip(
                    label: Text(switch (_countOn(shelf)) {
                      final int count => '${shelf.words} $count',
                      null => shelf.words,
                    }),
                    selected: _shelf == shelf,
                    labelStyle: Theme.of(context).textTheme.titleSmall?.copyWith(color: _shelf == shelf ? BuddyColors.cherry : BuddyColors.ink),
                    onSelected: (_) => setState(() => _shelf = shelf),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ...switch (_shelf) {
            GuidebookShelf.resources => _itemsShelf(
                widget.guidebook.resources,
                nothingYet: "Nothing here yet. Buddy reads Temple's office pages each day, and the services it finds will show here.",
              ),
            GuidebookShelf.opportunities => _opportunitiesShelf(),
            GuidebookShelf.contacts => _itemsShelf(
                widget.guidebook.contacts,
                nothingYet: "Nothing here yet. Buddy reads Temple's office pages each day, and the people and offices it finds will show here.",
              ),
          },
        ],
      ),
    );
  }
}

/// A Resource or Contact in the list: enough to tell whether it's the one, and where it was found.
class _ItemRow extends StatefulWidget {
  const _ItemRow({super.key, required this.item, required this.openPhone, required this.onTap});

  final GuidebookItem item;
  final PhoneOpener openPhone;
  final VoidCallback onTap;

  @override
  State<_ItemRow> createState() => _ItemRowState();
}

class _ItemRowState extends State<_ItemRow> {
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
    final text = Theme.of(context).textTheme;
    final item = widget.item;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          button: true,
          container: true,
          label: [item.name, item.summary, ?item.cost].join('. '),
          onTap: widget.onTap,
          excludeSemantics: true,
          child: InkWell(
            onTap: widget.onTap,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  IconTile(item.isContact ? Icons.person_outline : Icons.local_library_outlined),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, style: text.titleMedium),
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(item.summary, maxLines: 3, overflow: TextOverflow.ellipsis),
                        ),
                        if (item.cost case final cost?)
                          Padding(padding: const EdgeInsets.only(top: 2), child: Text(cost, style: text.bodySmall)),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Icon(Icons.chevron_right, color: BuddyColors.inkSoft),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(RowGroup.indentPastIcon, 0, 16, 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SourceLinks(sources: item.sources, open: _open, mostShown: 1),
              if (_problem case final problem?) ProblemNote(problem),
            ],
          ),
        ),
      ],
    );
  }
}

/// One Resource or Contact, with everything known about it and what can be done from here.
class GuidebookItemScreen extends StatelessWidget {
  const GuidebookItemScreen({super.key, required this.item, required this.openPhone, required this.report, required this.askBuddy});

  final GuidebookItem item;
  final PhoneOpener openPhone;
  final Future<void> Function(GuidebookItem item) report;
  final void Function(String words) askBuddy;

  @override
  Widget build(BuildContext context) {
    return SubScreen(
      topIcon: item.isContact ? Icons.person_outline : Icons.local_library_outlined,
      title: item.name,
      subtitle: item.isContact ? 'Contact' : 'Resource',
      children: [
        GuidebookItemBody(
          item: item,
          openPhone: openPhone,
          report: report,
          largeActions: true,
          onReported: () => Navigator.of(context).pop(),
          extraAction: OutlinedButton(
            onPressed: () => askBuddy('Tell me about ${item.name}.'),
            child: Text('Ask Buddy about this', semanticsLabel: 'Ask Buddy about ${item.name}'),
          ),
        ),
      ],
    );
  }
}
