# Paint appearance

This is a native skin for the packaged KolourPaint application. The engine,
canvas, drawing tools, image colors, undo history, PNG encoding, keyboard
shortcuts and ordinary file operations remain KolourPaint's. The shell's
cream, navy, teal and gold colors extend into the toolbars, menus, controls,
status bar and native dialogs, with square raised buttons and clear selected
tools. The main toolbar keeps text labels below its familiar action icons.

The skin is supplied by original `paint.qss` and `paint/*.svg` files. These
assets contain no third-party artwork, scripts, remote URLs or fonts. DejaVu
Sans and Breeze action icons come from separately installed Linux packages,
with their original notices retained. `paint-kdeglobals` supplies matching
KDE palette and font defaults. It is a first-run default, not permission to
replace a user's existing preferences.

The fixed approved Paint command adds:

```text
-style Fusion -stylesheet /opt/kidos-native-session/theme/paint.qss
```

Qt resolves the SVG paths beside the stylesheet. Keep the stylesheet and all
of its referenced assets in the protected installation receipt. A caller
must never choose a stylesheet or asset path. Ordinary PNG file-opening via
the desktop MIME handler also needs the themed launch path; passing arguments
only from Applications does not theme an independently launched instance.

The stylesheet deliberately has no universal background rule and does not
target the canvas or color-cell table. Native window title bars belong to
the Linux compositor and need the matching compositor theme; Qt styling
alone cannot change them. This skin does not rearrange or remove mature
application commands. Further changes to application structure would require
KolourPaint configuration or a maintained source patch.

Acceptance requires actual Linux checks of the initial window, readable
tooltips and menus, every tool remaining accessible, selection/hover/focus
states, image colors, drawing/undo, save dialog, PNG reopen and Files/Trash.
Local asset checks do not certify these graphical or physical-Pi behaviors.
The parent native-app verification record records the checks actually run.

Primary implementation references:

- [Qt application command-line styling](https://doc.qt.io/qt-6/qapplication.html)
- [Qt widget style sheet reference](https://doc.qt.io/qt-6/stylesheet-reference.html)
- [KolourPaint toolbar layout](https://github.com/KDE/kolourpaint/blob/master/kolourpaintui.rc)
- [KolourPaint tools and their shortcuts](https://docs.kde.org/stable_kf6/en/kolourpaint/kolourpaint/tool-reference.html)
