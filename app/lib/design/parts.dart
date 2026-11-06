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
          runSpacing: 4,
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
      padding: const EdgeInsets.only(bottom: 10),
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
      padding: const EdgeInsets.only(left: 4, bottom: 10),
      child: Semantics(
        header: true,
        label: words,
        excludeSemantics: true,
        child: Text(words.toUpperCase(), style: Theme.of(context).textTheme.labelMedium),
      ),
    );
  }
}

/// Rows that belong together, in one soft frame with a hairline between each.
class RowGroup extends StatelessWidget {
  const RowGroup({super.key, required this.children, this.dividerIndent = 16});

  final List<Widget> children;
  final double dividerIndent;

  /// Where the hairline starts under a row with an icon, so that it lines up with the words.
  static const indentPastIcon = 72.0;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: BuddyColors.frame,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.cardRadius)),
      child: _OnAFrame(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final (index, child) in children.indexed) ...[
              if (index > 0) Divider(indent: dividerIndent, endIndent: 16),
              child,
            ],
          ],
        ),
      ),
    );
  }
}

/// A rounded square holding an icon, which says at a glance what something is about. It's decorative, so a screen
/// reader skips it: the words beside it always say the same.
class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key, this.size = BuddySizes.iconSquare, this.color = BuddyColors.ink, this.tint = BuddyColors.cherryTint});

  final IconData icon;
  final double size;
  final Color color;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(size * 0.31)),
        child: Icon(icon, size: size * 0.48, color: color),
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
    this.iconTint,
    this.below,
    this.semanticsLabel,
    required this.onTap,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Color? iconColor;
  final Color? iconTint;

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
          constraints: const BoxConstraints(minHeight: 66),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                if (icon case final icon?) ...[
                  IconTile(icon, color: iconColor ?? BuddyColors.ink, tint: iconTint ?? BuddyColors.cherryTint),
                  const SizedBox(width: 14),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: text.titleMedium),
                      if (subtitle case final subtitle?)
                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle, style: text.bodySmall)),
                      if (below case final below?) Padding(padding: const EdgeInsets.only(top: 6), child: below),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const ExcludeSemantics(child: Icon(Icons.chevron_right, size: 22, color: BuddyColors.inkSoft)),
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
      PillTone.quiet => (BuddyColors.quiet, BuddyColors.inkSoft),
      PillTone.warning => (BuddyColors.warningTint, BuddyColors.warningInk),
    };
    return DecoratedBox(
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(BuddySizes.chipRadius)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon case final icon?) ...[
              ExcludeSemantics(child: Icon(icon, size: 15, color: foreground)),
              const SizedBox(width: 5),
            ],
            Flexible(child: Text(words, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: foreground, fontSize: 13))),
          ],
        ),
      ),
    );
  }
}

/// Makes a quiet button inside a frame white, so that it still stands out on the gray or the tint.
class _OnAFrame extends StatelessWidget {
  const _OnAFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Theme(
      data: theme.copyWith(outlinedButtonTheme: OutlinedButtonThemeData(style: quietButtonOnFrame(theme))),
      child: child,
    );
  }
}

/// A card, in the conversation or on a screen: a soft gray frame, or a tinted one, with no heavy border. A quiet
/// button inside it turns white, so that it still stands out. It isn't a node of its own for a screen reader, because a
/// card holds controls as well as words, and each card says what it is in its own label.
class CardFrame extends StatelessWidget {
  const CardFrame({super.key, required this.child, this.color = BuddyColors.frame, this.border, this.padding = const EdgeInsets.all(16)});

  final Widget child;
  final Color color;

  /// Only for a card that mustn't be missed, such as one with crisis Resources.
  final BorderSide? border;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BuddySizes.cardRadius),
        side: border ?? BorderSide.none,
      ),
      child: _OnAFrame(child: Padding(padding: padding, child: child)),
    );
  }
}

/// The top of a card: a tinted square with its icon, the card's title, and a muted line under it that says what kind
/// of thing it is or how it stands. A screen reader hears the card's own label, so none of this is read out twice.
class CardHeading extends StatelessWidget {
  const CardHeading({
    super.key,
    required this.icon,
    required this.title,
    this.line,
    this.iconColor = BuddyColors.ink,
    this.iconTint = BuddyColors.cherryTint,
    this.titleStyle,
  });

  final IconData icon;
  final String title;
  final String? line;
  final Color iconColor;
  final Color iconTint;
  final TextStyle? titleStyle;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        IconTile(icon, color: iconColor, tint: iconTint),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            // So that a one-line title sits level with the middle of the square.
            padding: EdgeInsets.only(top: line == null ? 9 : 1),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: titleStyle ?? text.titleMedium),
                if (line case final line?) Padding(padding: const EdgeInsets.only(top: 1), child: Text(line, style: text.bodySmall)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// A white panel inside a card, for exactly what will happen, such as the words of an email.
class InnerPanel extends StatelessWidget {
  const InnerPanel({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: BuddyColors.surface, borderRadius: BorderRadius.circular(BuddySizes.panelRadius)),
      child: Padding(padding: const EdgeInsets.fromLTRB(14, 6, 14, 14), child: child),
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
    return CardFrame(
      color: BuddyColors.warningTint,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IconTile(icon, color: BuddyColors.warningInk, tint: BuddyColors.surface),
              const SizedBox(width: 12),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 2),
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
              ),
            ],
          ),
          if (action case final action?) Padding(padding: const EdgeInsets.only(top: 14), child: action),
        ],
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
        child: DecoratedBox(
          decoration: BoxDecoration(color: BuddyColors.problemTint, borderRadius: BorderRadius.circular(BuddySizes.panelRadius)),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const ExcludeSemantics(child: Padding(padding: EdgeInsets.only(top: 3), child: Icon(Icons.error_outline, size: 18, color: BuddyColors.problem))),
                const SizedBox(width: 8),
                Expanded(child: Text(words, style: const TextStyle(color: BuddyColors.problem))),
              ],
            ),
          ),
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon case final icon?) ...[
            IconTile(icon, size: 56, color: isProblem ? BuddyColors.problem : BuddyColors.cherry, tint: isProblem ? BuddyColors.problemTint : BuddyColors.cherryTint),
            const SizedBox(height: 14),
          ],
          if (title case final title?) ...[
            Semantics(header: true, container: true, child: Text(title, textAlign: TextAlign.center, style: text.titleMedium)),
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
        borderRadius: BorderRadius.circular(12),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: BuddySizes.tapTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 12,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.link, size: 16, color: canOpen ? BuddyColors.link : BuddyColors.inkSoft),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        'Source: ${_shortTitle(source.title)}',
                        style: text.bodySmall?.copyWith(
                          color: canOpen ? BuddyColors.link : BuddyColors.inkSoft,
                          decoration: canOpen ? TextDecoration.underline : null,
                          decorationColor: BuddyColors.link,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
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
    final labelText = Text(label, style: text.titleSmall?.copyWith(color: BuddyColors.inkSoft));
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

/// The back control at the top of every screen: a gray pill that says what it does in words, which an arrow alone
/// doesn't.
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
        child: Material(
          color: BuddyColors.quiet,
          shape: const StadiumBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: goBack,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: BuddySizes.tapTarget, minWidth: BuddySizes.tapTarget),
              child: Padding(
                padding: const EdgeInsets.only(left: 8, right: 16),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.chevron_left, color: BuddyColors.ink, size: 24),
                    const SizedBox(width: 2),
                    // The words stay this size, because they sit in a bar of a fixed height.
                    MediaQuery.withClampedTextScaling(
                      maxScaleFactor: 1.3,
                      child: Text('Back', style: Theme.of(context).textTheme.titleSmall),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The bar at the top of a screen opened from somewhere else, with the way back.
PreferredSizeWidget backBar() => AppBar(
      automaticallyImplyLeading: false,
      leadingWidth: 160,
      leading: const Padding(
        padding: EdgeInsetsDirectional.only(start: BuddySizes.pageEdge - 4),
        child: Align(alignment: AlignmentDirectional.centerStart, child: BackLink()),
      ),
      toolbarHeight: 60,
    );

/// A screen opened from somewhere else: the way back, a title, and everything below it scrolling together.
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
      appBar: backBar(),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: ListView(
                controller: controller,
                padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 8, BuddySizes.pageEdge, 28),
                children: [
                  if (topIcon case final topIcon?) ...[
                    Align(alignment: AlignmentDirectional.centerStart, child: IconTile(topIcon, size: 56, color: BuddyColors.cherry)),
                    const SizedBox(height: 16),
                  ],
                  if (title case final title?) ...[
                    PageTitle(title, subtitle: subtitle, isTab: false),
                    const SizedBox(height: 22),
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
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, container: true, child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(height: 8),
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

/// A frame that opens and closes what's in it, for what's there if it's wanted but needn't always be read.
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
      color: BuddyColors.frame,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BuddySizes.cardRadius)),
      child: _OnAFrame(
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
                  constraints: const BoxConstraints(minHeight: 58),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      children: [
                        if (widget.icon case final icon?) ...[IconTile(icon), const SizedBox(width: 14)],
                        Expanded(child: Text(widget.title, style: text.titleMedium)),
                        if (widget.trailing case final trailing?) ...[
                          Pill(trailing, tone: PillTone.quiet),
                          const SizedBox(width: 8),
                        ],
                        AnimatedRotation(
                          turns: _open ? 0.5 : 0,
                          duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 150),
                          child: const Icon(Icons.expand_more, color: BuddyColors.ink),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (_open) ...[
              const Divider(indent: 16, endIndent: 16),
              ...widget.children,
            ],
          ],
        ),
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

/// Opens a sheet that rises from the bottom: a title, a way to close it, and what's in it scrolling below. It's simply
/// there, without rising, for a Student who has asked their phone to cut down on movement.
Future<T?> showBuddySheet<T>(BuildContext context, {required String title, String? subtitle, required List<Widget> Function(BuildContext context) children}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    sheetAnimationStyle: MediaQuery.disableAnimationsOf(context) ? AnimationStyle.noAnimation : null,
    builder: (context) => _Sheet(title: title, subtitle: subtitle, children: children(context)),
  );
}

class _Sheet extends StatelessWidget {
  const _Sheet({required this.title, this.subtitle, required this.children});

  final String title;
  final String? subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Says that it can be pulled down. Closing it with the button does the same.
        const ExcludeSemantics(
          child: Center(
            child: Padding(
              padding: EdgeInsets.only(top: 10),
              child: SizedBox(
                width: 34,
                height: 4,
                child: DecoratedBox(decoration: BoxDecoration(color: BuddyColors.hairline, borderRadius: BorderRadius.all(Radius.circular(3)))),
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 12, 12, 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Semantics(header: true, container: true, child: Text(title, style: text.headlineMedium)),
                      if (subtitle case final subtitle?)
                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle, style: text.bodyMedium?.copyWith(color: BuddyColors.inkSoft))),
                    ],
                  ),
                ),
              ),
              IconButton(
                style: IconButton.styleFrom(backgroundColor: BuddyColors.quiet),
                icon: const Icon(Icons.close),
                tooltip: 'Close',
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
        const Divider(),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(BuddySizes.pageEdge, 16, BuddySizes.pageEdge, 24),
            children: children,
          ),
        ),
      ],
    );
  }
}
