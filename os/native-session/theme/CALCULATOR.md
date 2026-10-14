# kidOS Calculator appearance

Calculator keeps the mature KCalc engine and native keyboard, clipboard, memory,
history, scientific, statistics and numeral-system features. The kidOS launcher
uses Qt's Fusion style and `calculator.qss` for cream menus, raised square keys,
a paper display, navy focus and teal accents.

`calculator-kcalcrc` supplies first-use colors for KCalc's custom-painted display
and key labels. Numbers are cream, operations teal, memory/clear gold and extra
functions blue. The file also selects legible DejaVu Sans fonts. It does not
change numerical precision, modes, history, user constants or shortcuts.

The ordinary user setup seeds this file at the private `XDG_CONFIG_HOME/kcalcrc`
only when absent. Existing preferences are preserved byte for byte, including
family color/font choices. A theme upgrade never resets Calculator settings.
No application source patch, package replacement or privileged launch is used.
The upstream About dialog and credits remain available.

## Upstream interfaces checked

- [KCalc](https://apps.kde.org/kcalc/) provides the mature calculator and native
  configurable display/button colors.
- [KCalc 25.04 configuration schema](https://invent.kde.org/utilities/kcalc/-/blob/v25.04.0/kcalc.kcfg)
  defines the `Colors` and `Font` keys used here. They were also checked against
  `/usr/share/config.kcfg/kcalc.kcfg` in the disposable Debian ARM64 VM running
  package `4:25.04.0-1`.
- [KCalc's form](https://invent.kde.org/utilities/kcalc/-/blob/v25.04.0/kcalc.ui)
  supplies the named native display widgets; [its button paint routine](https://invent.kde.org/utilities/kcalc/-/blob/v25.04.0/kcalc_button.cpp)
  explains why a stylesheet alone cannot recolor the key text.
- [Qt application options](https://doc.qt.io/qt-6/qapplication.html) document
  `-style` and `-stylesheet`. All launch arguments are fixed repository values.
  The [Qt GUI options](https://doc.qt.io/qt-6/qguiapplication.html) also provide
  the `-qwindowtitle Calculator` first-window title override used by the launcher.

Source checks and launcher/preference fixture tests cannot certify the rendered
Linux appearance. Verify keypad sizing, keyboard calculation, focus and menus
in the Linux VM; physical Raspberry Pi validation remains separate.
