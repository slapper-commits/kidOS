"""Pure policy for the reviewed Debian live-build boot-menu templates.

No filesystem access, image execution, or device authority. Both the build hook
and the one-off ISO correction call this same exact transformation.
"""
import hashlib
import re

PATHS = ('/boot/grub/grub.cfg', '/isolinux/live.cfg', '/isolinux/menu.cfg')
CAPTURED_KERNEL = '6.12.111+deb13-amd64'
USB = ' live-media=removable-usb'
STOCK = ('7b90cd2513d14c91ba658808068463ab7abcf737f7564324b71befb287219501',
         'a8b534644bbb9bacb3c3b7741442e4bc1ab9561d80537dc6bf04c6132ea6b406',
         '1eda770eaaf9978903f5099d75985fb006bce450e50f290037569afa5e2fae92')
CLEAN = ('c6dfe14c5194ae2b2011e8419f67b6552e4e5a1d589e5164b7e84d6e7fffa4e5',
         STOCK[1],
         '1edfbda380c910d7b2f9a6915e8bf3d65b0efb2e189e4673d0c6cc7992e7bf16')
INSTALL_START = '# Installer (if any)\nif true; then\n'
UTILITIES = "submenu 'Utilities...' --hotkey=u {"
INSTALL_BODY = ("\nsource\t/boot/grub/install_start.cfg\n\n"
                "submenu 'Advanced install options ...' --hotkey=a {\n\n"
                "\tsource /boot/grub/theme.cfg\n\n"
                "\tsource\t/boot/grub/install.cfg\n\n}\nfi\n\n")
CLEAN_MARKER = '# kidOS: install through the live desktop confirmation flow.\n'
KERNEL = re.compile(r'(/live/(?:vmlinuz|initrd\.img)-)([0-9][A-Za-z0-9.+~\-]{0,127})(?=[ \t\n])')


def normalized(texts):
    """Normalize only a shared kernel version and all-or-none exact USB args."""
    count = sum(text.count(USB) for text in texts)
    assert count in (0, 6), 'Partial or duplicate removable-USB boot policy'
    live_lines = [line for text in texts for line in text.splitlines() if 'boot=live components' in line]
    assert len(live_lines) == 6
    assert all(line.count(USB) == (1 if count else 0) for line in live_lines), 'Each live entry needs exactly one USB policy'
    stripped = [text.replace(USB, '') for text in texts]
    assert not any('live-media' in text for text in stripped), 'Unknown live-media policy'
    versions = {match[2] for text in stripped for match in KERNEL.finditer(text)}
    assert len(versions) == 1, 'Boot kernel paths must identify one version'
    values = [KERNEL.sub(lambda match: match[1] + CAPTURED_KERNEL, text) for text in stripped]
    return tuple(hashlib.sha256(value.encode()).hexdigest() for value in values), count


def patch_configs(files):
    assert isinstance(files, dict) and set(files) == set(PATHS), 'Expected exactly three boot configurations'
    assert all(isinstance(files[path], bytes) and 0 < len(files[path]) <= 256 * 1024 for path in PATHS)
    texts = [files[path].decode('utf8') for path in PATHS]
    assert not any('\0' in text or '\r' in text for text in texts)
    state, usb_count = normalized(texts)
    assert state in (STOCK, CLEAN), 'Unsupported or partially modified boot-menu templates'
    if state == CLEAN:
        assert usb_count == 6, 'A cleaned menu lacks the complete USB restriction'
        return dict(files)
    grub, live, menu = texts
    if usb_count == 0:
        assert grub.count('boot=live components') == 4 and live.count('boot=live components') == 2
        grub = grub.replace('boot=live components', 'boot=live components' + USB)
        live = live.replace('boot=live components', 'boot=live components' + USB)
    assert grub.count(' findiso=${iso_path}') == 3
    grub = grub.replace(' findiso=${iso_path}', '')
    assert grub.count(INSTALL_START) == grub.count(UTILITIES) == 1
    left, rest = grub.split(INSTALL_START)
    installer, right = rest.split(UTILITIES)
    assert installer == INSTALL_BODY
    grub = left + CLEAN_MARKER + UTILITIES + right
    assert menu.count('include install.cfg\n') == 1
    menu = menu.replace('include install.cfg\n', '')
    output = [grub, live, menu]
    assert normalized(output) == (CLEAN, 6)
    return dict(zip(PATHS, (text.encode() for text in output)))
