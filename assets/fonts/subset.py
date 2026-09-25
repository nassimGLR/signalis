#!/usr/bin/env python3
"""Rebuild the WOFF2 subsets in this folder from the upstream OFL sources.

usage:  python3 assets/fonts/subset.py <dir-with-source-ttfs>

Needs fontTools and brotli (pip install fonttools brotli). The sources come
from github.com/google/fonts (the repository behind fonts.google.com):

  ofl/sofiasanscondensed/SofiaSansCondensed[wght].ttf
  ofl/ibmplexmono/IBMPlexMono-Regular.ttf, IBMPlexMono-Medium.ttf
  ofl/michroma/Michroma-Regular.ttf
  ofl/reeniebeanie/ReenieBeanie.ttf

What this does to them (all changes are Modified Versions under OFL 1.1; see OFL.txt):
  * subset to the characters the game draws, then save as WOFF2;
  * keep the copyright (name ID 0) and licence records (IDs 13, 14) in every file;
  * Sofia Sans Condensed: limit wght to 400-800 and make the Russian letterforms
    (its RUS 'locl' alternates) the default Cyrillic glyphs, because every
    Cyrillic string in the game is Russian and the default forms are Bulgarian;
  * IBM Plex Mono -> "L7 Mono" and Reenie Beanie -> "L7 Hand": renamed because
    their metadata declares a Reserved Font Name and a subset is a Modified Version.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = os.path.dirname(os.path.abspath(__file__))
OFL_URL = 'https://openfontlicense.org'
OFL_DESC = ('This Font Software is licensed under the SIL Open Font License, Version 1.1. '
            'This license is available with a FAQ at: ' + OFL_URL)

TEXT = ('U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+0400-04FF,'
        'U+2000-206F,U+20AC,U+2116,U+2122,U+2190-21FF,U+2212,U+2215,U+2500-25FF')
HAND = 'U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201A,U+201C-201E,U+2020-2022,U+2026'
LOGO = 'U+0020,U+002D-002E,U+0030-0039,U+0041-005A,U+00B7'
FEATURES = ['kern', 'liga', 'calt', 'case', 'tnum', 'zero', 'ccmp', 'mark', 'mkmk']


def unicodes(spec):
    out = []
    for part in spec.split(','):
        a, _, b = part[2:].partition('-')
        out.extend(range(int(a, 16), int(b or a, 16) + 1))
    return out


def russian_default(font):
    """Point the Cyrillic code points at the RUS 'locl' alternates."""
    gsub = font['GSUB'].table
    feats = gsub.FeatureList.FeatureRecord
    lookups = set()
    for sr in gsub.ScriptList.ScriptRecord:
        if sr.ScriptTag != 'cyrl':
            continue
        for ls in sr.Script.LangSysRecord:
            if ls.LangSysTag.strip() == 'RUS':
                for fi in ls.LangSys.FeatureIndex:
                    if feats[fi].FeatureTag == 'locl':
                        lookups.update(feats[fi].Feature.LookupListIndex)
    swap = {}
    for li in lookups:
        for st in gsub.LookupList.Lookup[li].SubTable:
            st = getattr(st, 'ExtSubTable', st)
            swap.update(getattr(st, 'mapping', {}) or {})
    if not swap:
        raise SystemExit('no RUS locl alternates found')
    for table in font['cmap'].tables:
        if table.isUnicode():
            for cp, g in list(table.cmap.items()):
                if g in swap:
                    table.cmap[cp] = swap[g]
    return len(swap)


def set_names(font, family=None, ps=None, source=None, description=None, licence=None):
    name = font['name']
    if family:
        for rec in list(name.names):
            if rec.nameID in (1, 3, 4, 6, 16, 17, 18, 21, 22, 25):
                s = rec.toUnicode()
                s = s.replace(source[0], family).replace(source[1], ps)
                name.setName(s, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
        name.removeNames(nameID=7)  # the upstream trademark line names the original font
    if description:
        name.setName(description, 10, 3, 1, 0x409)
    name.setName(licence or OFL_DESC, 13, 3, 1, 0x409)
    name.setName(OFL_URL, 14, 3, 1, 0x409)


def build(src, out, text, *, prep=None, **names):
    font = TTFont(src)
    if prep:
        prep(font)
    opts = subset.Options()
    opts.layout_features = FEATURES
    opts.name_IDs = ['*']
    opts.name_languages = [0x409]
    opts.flavor = 'woff2'
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes(text))
    sub.subset(font)
    set_names(font, **names)
    font.flavor = 'woff2'
    font.save(os.path.join(OUT, out))
    print(f'{out:32s} {os.path.getsize(os.path.join(OUT, out)):7d} bytes')


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    d = sys.argv[1]

    def sofia(font):
        instancer.instantiateVariableFont(font, {'wght': (400, 800)}, inplace=True)
        print('  Russian forms made default:', russian_default(font), 'glyphs')

    build(os.path.join(d, 'SofiaSansCondensed[wght].ttf'), 'SofiaSansCondensed-VF.woff2', TEXT, prep=sofia)
    for style in ('Regular', 'Medium'):
        build(os.path.join(d, f'IBMPlexMono-{style}.ttf'), f'L7Mono-{style}.woff2', TEXT,
              family='L7 Mono', ps='L7Mono', source=('IBM Plex Mono', 'IBMPlexMono'),
              description='L7 Mono is a Modified Version (subset and renamed) of IBM Plex Mono, '
                          'Copyright 2017 IBM Corp., with Reserved Font Name "Plex". '
                          'Licensed under the SIL Open Font License 1.1.')
    build(os.path.join(d, 'Michroma-Regular.ttf'), 'Michroma-Regular.woff2', LOGO)
    build(os.path.join(d, 'ReenieBeanie.ttf'), 'L7Hand-Regular.woff2', HAND,
          family='L7 Hand', ps='L7Hand', source=('Reenie Beanie', 'ReenieBeanie'),
          description='L7 Hand is a Modified Version (subset and renamed) of Reenie Beanie, '
                      'Copyright (c) 2010, James Grieshaber (www.typeco.com). '
                      'Licensed under the SIL Open Font License 1.1.',
          licence='Copyright (c) 2010, James Grieshaber (www.typeco.com), with Reserved Font Name '
                  'Reenie Beanie. ' + OFL_DESC)


if __name__ == '__main__':
    main()
