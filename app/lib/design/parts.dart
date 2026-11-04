import 'package:flutter/material.dart';

import '../backend/buddy_backend.dart';
import 'theme.dart';

/// The title at the top of a tab or screen, with what it's about below it and an optional link beside it.
class PageTitle extends StatelessWidget {
  const PageTitle(this.title, {super.key, this.subtitle, this.trailing, this.isTab = true});

  final String title;
  final String? subtitle;
  final Widget? trailing;

  /// A tab's title is larger than a screen's, because it can be a word or two, and a screen's can be a question.
  final bool isTab;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Wraps, so that large text puts the link on a line of its own rather than squeezing the title.
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          children: [
            Semantics(header: true, container: true, child: Text(title, style: isTab ? text.displaySmall : text.headlineMedium)),
            ?trailing,
          ],
        ),
        if (subtitle case final subtitle?)
          Semantics(
            container: true,
            child: Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(subtitle, style: text.bodyMedium?.copyWith(color: BuddyColors.inkSoft)),
            ),
          ),
      ],
    );
  }
}

/// A section's title, with a short note or a link beside it.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 12,
        children: [
          Semantics(header: true, container: true, child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
          ?trailing,
        ],
      ),
    );
  }
}

/// The small capitals above a group of rows. A screen reader gets the words as written, not spelled out.
class GroupLabel extends StatelessWidget {
  const GroupLabel(this.words, {super.key});

  final String words;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 8),
      child: Semantics(
        header: true,
        label: words,
        excludeSemantics: true,
        child: Text(words.toUpperCase(), style: Theme.of(context).textTheme.labelMedium),
      ),
    );
  }
}

/// Rows that belong together, with a hairline between each.
class RowGroup extends StatelessWidget {
  const RowGroup({super.key, required this.children, this.dividerIndent = 16});

  final List<Widget> children;
  final double dividerIndent;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: BuddyColors.surface,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BuddySizes.cardRadius),
        side: const BorderSide(color: BuddyColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, child) in children.indexed) ...[
            if (index > 0) Divider(indent: dividerIndent, endIndent: dividerIndent),
            child,
          ],
        ],
      ),
    );
  }
}

/// A row that leads to another screen: what's there, what state it's in, and a chevron that says it goes somewhere.
class NavRow extends StatelessWidget {
  const NavRow({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    this.iconColor,
    this.below,
    this.semanticsLabel,
    required this.onTap,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color? iconColor;

  /// Goes under the title, such as a pill. It isn't read out, so [semanticsLabel] has to say the same in words.
  final Widget? below;

  /// What a screen reader says, when the words on the row aren't enough by themselves.
  final String? semanticsLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      container: true,
      label: semanticsLabel ?? [title, ?subtitle].join('. '),
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 64),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                if (icon case final icon?) ...[
                  ExcludeSemantics(child: Icon(icon, size: 26, color: iconColor ?? BuddyColors.ink)),
                  const SizedBox(width: 16),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: text.titleMedium),
                      if (subtitle case final subtitle?)
                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle, style: text.bodySmall)),
                      if (below case final below?) Padding(padding: const EdgeInsets.only(top: 4), child: below),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const ExcludeSemantics(child: Icon(Icons.chevron_right, color: BuddyColors.inkSoft)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum PillTone { cherry, solidCherry, quiet, warning }

/// A short label for a state or a kind, such as Practice mode or a Goal's name.
class Pill extends StatelessWidget {
  const Pill(this.words, {super.key, this.tone = PillTone.cherry, this.icon});

  final String words;
  final PillTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (background, foreground) = switch (tone) {
      PillTone.cherry => (BuddyColors.cherryTint, BuddyColors.cherry),
      PillTone.solidCherry => (BuddyColors.cherry, Colors.white),
      PillTone.quiet => (BuddyColors.surfaceQuiet, BuddyColors.inkSoft),
      PillTone.warning => (BuddyColors.warningTint, BuddyColors.warningInk),
    };
    return DecoratedBox(
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon case final icon?) ...[
              ExcludeSemantics(child: Icon(icon, size: 15, color: foreground)),
              const SizedBox(width: 4),
            ],
            Flexible(child: Text(words, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: foreground, fontSize: 13))),
          ],
        ),
      ),
    );
  }
}

/// A rounded square holding an icon, which says at a glance what a screen is about.
class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key, this.size = 64});

  final IconData icon;
  final double size;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: BuddyColors.cherryTint, borderRadius: BorderRadius.circular(size / 4)),
        child: Icon(icon, size: size / 2, color: BuddyColors.ink),
      ),
    );
  }
}

/// Something the Student should notice before the rest of the screen: an icon, a title, a few words and what to do.
class NoticeCard extends StatelessWidget {
  const NoticeCard({super.key, this.icon = Icons.warning_amber_rounded, this.title, this.words, this.action, this.announce = false});

  final IconData icon;
  final String? title;
  final String? words;
  final Widget? action;

  /// Read out when it appears.
  final bool announce;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: BuddyColors.warningTint,
        border: Border.all(color: BuddyColors.warningBorder),
        borderRadius: BorderRadius.circular(BuddySizes.cardRadius),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ExcludeSemantics(child: Icon(icon, size: 26, color: BuddyColors.warningInk)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (title case final title?) Semantics(header: true, container: true, child: Text(title, style: text.titleMedium)),
                      if (words case final words?)
                        Semantics(
                          container: true,
                          liveRegion: announce,
                          child: Padding(padding: EdgeInsets.only(top: title == null ? 0 : 4), child: Text(words)),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (action case final action?) Padding(padding: const EdgeInsets.only(top: 12), child: action),
          ],
        ),
      ),
    );
  }
}

/// Says something went wrong, where a screen reader will read it out.
class ProblemNote extends StatelessWidget {
  const ProblemNote(this.words, {super.key});

  final String words;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      liveRegion: true,
      child: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const ExcludeSemantics(child: Padding(padding: EdgeInsets.only(top: 1), child: Icon(Icons.error_outline, size: 18, color: BuddyColors.problem))),
            const SizedBox(width: 6),
            Expanded(child: Text(words, style: const TextStyle(color: BuddyColors.problem))),
          ],
        ),
      ),
    );
  }
}

/// What just happened, in place, for the Student to read. [isProblem] marks it as something that went wrong.
class StatusNote extends StatelessWidget {
  const StatusNote(this.words, {super.key, this.isProblem = false});

  final String words;
  final bool isProblem;

  @override
  Widget build(BuildContext context) {
    if (isProblem) return ProblemNote(words);
    return Semantics(
      container: true,
      liveRegion: true,
      child: Padding(padding: const EdgeInsets.only(top: 8), child: Text(words)),
    );
  }
}

/// Nothing here yet, or nothing could be loaded: what belongs here, how it gets here and the way to start.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, this.icon, this.title, required this.words, this.action, this.isProblem = false});

  final IconData? icon;
  final String? title;
  final String words;
  final Widget? action;
  final bool isProblem;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon case final icon?) ...[IconTile(icon), const SizedBox(height: 16)],
          if (title case final title?) ...[
            Semantics(header: true, container: true, child: Text(title, textAlign: TextAlign.center, style: text.titleLarge)),
            const SizedBox(height: 4),
          ],
          Semantics(
            container: true,
            liveRegion: isProblem,
            child: Text(words, textAlign: TextAlign.center, style: text.bodyMedium?.copyWith(color: BuddyColors.inkSoft)),
          ),
          if (action case final action?) ...[const SizedBox(height: 16), action],
        ],
      ),
    );
  }
}

/// A page's title often ends with its site's name, which only makes the link longer. The whole title is still read out.
String _shortTitle(String title) {
  final first = title.split(' | ').first.trim();
  return first.split(' ').length >= 2 ? first : title;
}

/// A web page Buddy read something from, which the Student can open and read for themselves.
class SourceLink extends StatelessWidget {
  const SourceLink({super.key, required this.source, required this.open});

  final GuidebookSource source;
  final void Function(Uri address) open;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final localizations = MaterialLocalizations.of(context);
    final address = Uri.tryParse(source.url);
    final canOpen = address?.scheme == 'https';
    final lastSeen = source.lastSeenAt.toLocal();
    final onTap = canOpen ? () => open(address!) : null;
    return Semantics(
      button: true,
      enabled: canOpen,
      container: true,
      label: 'Open Source: ${source.title}, last seen ${localizations.formatFullDate(lastSeen)}',
      onTap: onTap,
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: BuddySizes.tapTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              children: [
                Text(
                  'Source: ${_shortTitle(source.title)}',
                  style: text.bodySmall?.copyWith(
                    color: canOpen ? BuddyColors.link : BuddyColors.inkSoft,
                    decoration: canOpen ? TextDecoration.underline : null,
                    decorationColor: BuddyColors.link,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text('Last seen ${localizations.formatShortMonthDay(lastSeen)}', style: text.bodySmall),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// An item's Sources: a few, then how many others there are.
class SourceLinks extends StatelessWidget {
  const SourceLinks({super.key, required this.sources, required this.open, this.mostShown = 3});

  final List<GuidebookSource> sources;
  final void Function(Uri address) open;
  final int mostShown;

  @override
  Widget build(BuildContext context) {
    final more = sources.length - mostShown;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final source in sources.take(mostShown)) SourceLink(source: source, open: open),
        if (more > 0) Text('Also on $more more of its pages.', style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

/// A link that goes somewhere within the app, with an optional icon before it.
class AppLink extends StatelessWidget {
  const AppLink(this.words, {super.key, this.icon, this.color, this.semanticsLabel, required this.onPressed});

  final String words;
  final IconData? icon;
  final Color? color;
  final String? semanticsLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final style = TextButton.styleFrom(foregroundColor: color ?? BuddyColors.link);
    final label = Text(words, semanticsLabel: semanticsLabel);
    if (icon case final icon?) {
      return TextButton.icon(style: style, onPressed: onPressed, icon: Icon(icon, size: 20), label: label);
    }
    return TextButton(style: style, onPressed: onPressed, child: label);
  }
}

/// A line of the form "Label  value", which stacks when large text leaves no room for two columns.
class LabelledLine extends StatelessWidget {
  const LabelledLine({super.key, required this.label, required this.value, this.labelWidth = 104});

  final String label;
  final String value;
  final double labelWidth;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final isLarge = MediaQuery.textScalerOf(context).scale(10) > 13;
    final labelText = Text(label, style: text.titleSmall);
    final valueText = Text(value);
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: isLarge
          ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [labelText, valueText])
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: labelWidth, child: labelText),
                const SizedBox(width: 8),
                Expanded(child: valueText),
              ],
            ),
    );
  }
}

/// The back control at the top of every screen. It says what it does in words, which an arrow alone doesn't.
class BackLink extends StatelessWidget {
  const BackLink({super.key});

  @override
  Widget build(BuildContext context) {
    void goBack() => Navigator.of(context).maybePop();
    return Tooltip(
      message: 'Back',
      excludeFromSemantics: true,
      child: Semantics(
        button: true,
        label: 'Back',
        onTap: goBack,
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(BuddySizes.controlRadius),
          onTap: goBack,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: BuddySizes.tapTarget, minWidth: BuddySizes.tapTarget),
            child: Padding(
              padding: const EdgeInsets.only(left: 8, right: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.chevron_left, color: BuddyColors.ink, size: 26),
                  // The words stay this size, because they sit in a bar of a fixed height.
                  MediaQuery.withClampedTextScaling(maxScaleFactor: 1.3, child: Text('Back', style: Theme.of(context).textTheme.bodyLarge)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A screen opened from somewhere else: the way back, a large title, and everything below it scrolling together.
class SubScreen extends StatelessWidget {
  const SubScreen({super.key, this.title, this.subtitle, this.topIcon, required this.children, this.bottom, this.controller});

  final String? title;
  final String? subtitle;
  final IconData? topIcon;
  final List<Widget> children;

  /// Stays on the screen above the keyboard, however far the list has scrolled.
  final Widget? bottom;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leadingWidth: 160,
        leading: const Align(alignment: AlignmentDirectional.centerStart, child: BackLink()),
        toolbarHeight: 52,
      ),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 4, BuddySizes.pageEdge, 24),
                children: [
                  if (topIcon case final topIcon?) ...[
                    Align(alignment: AlignmentDirectional.centerStart, child: IconTile(topIcon)),
                    const SizedBox(height: 16),
                  ],
                  if (title case final title?) ...[
                    PageTitle(title, subtitle: subtitle, isTab: false),
                    const SizedBox(height: 20),
                  ],
                  ...children,
                ],
              ),
            ),
            if (bottom case final bottom?)
              Padding(padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 4, BuddySizes.pageEdge, 12), child: bottom),
          ],
        ),
      ),
    );
  }
}

/// A heading and what's under it, for a long screen that's read top to bottom.
class ScreenSection extends StatelessWidget {
  const ScreenSection({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, container: true, child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(height: 6),
          ...children,
        ],
      ),
    );
  }
}

/// The spinner a section shows until its answer comes, labelled for a screen reader.
class LoadingBlock extends StatelessWidget {
  const LoadingBlock({super.key, this.label});

  final String? label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Center(child: CircularProgressIndicator(semanticsLabel: label)),
    );
  }
}

/// An outline that opens and closes what's in it, for what's there if it's wanted but needn't always be read.
class Expander extends StatefulWidget {
  const Expander({super.key, required this.title, this.trailing, this.icon, required this.children, this.startsOpen = false});

  final String title;
  final String? trailing;
  final IconData? icon;
  final List<Widget> children;
  final bool startsOpen;

  @override
  State<Expander> createState() => _ExpanderState();
}

class _ExpanderState extends State<Expander> {
  late bool _open = widget.startsOpen;

  void _toggle() => setState(() => _open = !_open);

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Material(
      color: BuddyColors.surface,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BuddySizes.cardRadius),
        side: const BorderSide(color: BuddyColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            expanded: _open,
            container: true,
            label: [widget.title, ?widget.trailing].join(', '),
            onTap: _toggle,
            excludeSemantics: true,
            child: InkWell(
              onTap: _toggle,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 56),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    children: [
                      if (widget.icon case final icon?) ...[Icon(icon, size: 26, color: BuddyColors.ink), const SizedBox(width: 12)],
                      Expanded(child: Text(widget.title, style: text.titleMedium)),
                      if (widget.trailing case final trailing?) ...[Text(trailing, style: text.bodyMedium), const SizedBox(width: 8)],
                      AnimatedRotation(
                        turns: _open ? 0.5 : 0,
                        duration: const Duration(milliseconds: 150),
                        child: const Icon(Icons.expand_more, color: BuddyColors.ink),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (_open) ...[
            const Divider(),
            ...widget.children,
          ],
        ],
      ),
    );
  }
}

class RowMenuItem {
  const RowMenuItem(this.words, {required this.semanticsLabel, required this.onSelected});

  final String words;
  final String semanticsLabel;
  final VoidCallback onSelected;
}

/// What can be done to a row, kept out of the way until it's wanted, so that a long list stays easy to read.
class RowMenu extends StatelessWidget {
  const RowMenu({super.key, required this.tooltip, required this.items, this.enabled = true});

  final String tooltip;
  final List<RowMenuItem> items;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<RowMenuItem>(
      tooltip: tooltip,
      enabled: enabled,
      icon: const Icon(Icons.more_horiz, color: BuddyColors.inkSoft),
      onSelected: (item) => item.onSelected(),
      itemBuilder: (context) => [
        for (final item in items)
          PopupMenuItem<RowMenuItem>(
            value: item,
            child: Text(item.words, semanticsLabel: item.semanticsLabel),
          ),
      ],
    );
  }
}
