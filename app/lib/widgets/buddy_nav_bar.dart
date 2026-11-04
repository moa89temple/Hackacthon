import 'package:flutter/material.dart';

import '../design/theme.dart';

class NavDestination {
  const NavDestination({required this.label, required this.icon, required this.selectedIcon});

  final String label;
  final IconData icon;

  /// Filled, so that a Student who can't tell the tint apart can still see which tab they're on.
  final IconData selectedIcon;
}

/// The four tabs, always labelled, with the selected one marked by its filled icon, its color and a tint behind both.
class BuddyNavBar extends StatelessWidget {
  const BuddyNavBar({super.key = const ValueKey('nav'), required this.destinations, required this.selected, required this.onSelected});

  final List<NavDestination> destinations;
  final int selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: BuddyColors.surface,
        border: Border(top: BorderSide(color: BuddyColors.hairline)),
      ),
      child: SafeArea(
        top: false,
        // Tabs have a fixed place to sit, so their labels only grow so far. Everything they lead to grows in full.
        child: MediaQuery.withClampedTextScaling(
          maxScaleFactor: 1.3,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
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
    final color = isSelected ? BuddyColors.cherry : BuddyColors.ink;
    return Semantics(
      button: true,
      selected: isSelected,
      container: true,
      label: '${destination.label}, tab $position of $total',
      onTap: onTap,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Material(
          color: isSelected ? BuddyColors.cherryTint : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 56),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(isSelected ? destination.selectedIcon : destination.icon, color: color, size: 24),
                    const SizedBox(height: 2),
                    Text(
                      destination.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: color,
                        fontSize: 13,
                        fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      ),
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
