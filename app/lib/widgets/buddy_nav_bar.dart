import 'package:flutter/material.dart';

import '../design/theme.dart';

class NavDestination {
  const NavDestination({required this.label, required this.icon, required this.selectedIcon});

  /// Said by a screen reader and shown by the tooltip, because the bar itself shows only icons.
  final String label;
  final IconData icon;

  /// Filled, so that a Student who can't tell the tint apart can still see which tab they're on.
  final IconData selectedIcon;
}

/// The four tabs, as icons in a pill that floats above the bottom of the screen. The selected one sits on a cherry
/// tint, in cherry, with its filled icon. Each has its name in a tooltip and for a screen reader.
class BuddyNavBar extends StatelessWidget {
  const BuddyNavBar({super.key = const ValueKey('nav'), required this.destinations, required this.selected, required this.onSelected});

  final List<NavDestination> destinations;
  final int selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: BuddyColors.canvas,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 4, 22, 8),
          child: Center(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: BuddyColors.surface,
                  borderRadius: BorderRadius.circular(BuddySizes.floatingRadius),
                  border: Border.all(color: BuddyColors.frame),
                  boxShadow: BuddyShadows.floating,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Row(
                    children: [
                      for (final (index, destination) in destinations.indexed)
                        Expanded(
                          child: _NavItem(
                            destination: destination,
                            isSelected: index == selected,
                            position: index + 1,
                            total: destinations.length,
                            onTap: () => onSelected(index),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.destination, required this.isSelected, required this.position, required this.total, required this.onTap});

  final NavDestination destination;
  final bool isSelected;
  final int position;
  final int total;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: destination.label,
      excludeFromSemantics: true,
      child: Semantics(
        button: true,
        selected: isSelected,
        container: true,
        label: '${destination.label}, tab $position of $total',
        onTap: onTap,
        excludeSemantics: true,
        child: Material(
          color: isSelected ? BuddyColors.cherryTint : Colors.transparent,
          borderRadius: BorderRadius.circular(BuddySizes.floatingRadius - 4),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: SizedBox(
              height: BuddySizes.tapTarget,
              child: Center(
                child: Icon(
                  isSelected ? destination.selectedIcon : destination.icon,
                  color: isSelected ? BuddyColors.cherry : BuddyColors.ink,
                  size: 24,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
