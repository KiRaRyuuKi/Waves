"""Minimal Indonesian-to-phoneme for the zh_ja_mixture symbol table.

The VITS symbols exported by symbols.py only cover the mixed JP/CN phone
set plus bare latin letters. Indonesian is close enough to that latin set
that a rule-based transliteration works: we map each grapheme onto the
closest sound the model already knows, and drop letters the table cannot
express (q, x) by expanding them to the nearest phones (k, ks).

Single letters:
    a b d e f g h i j k m n o p r s t u v w z     -> themselves
    c                                        -> ʧ  (ch as in "cakap")
    l                                        -> r  (alveolar tap /l/ ~ /r/)
    y                                        -> j  (glide /j/)
    q                                        -> k
    x                                        -> ks
Digraphs:
    ng -> N   (ŋ)      ny -> nj (ɲ)          sy -> ʃ
    ts -> ʦ            kh -> k               th -> t
Punctuation kept as-is (the symbol set includes , . ! ? - ~ … and space).
"""

import re

_SPACE = ' '
_KEEP = ',.!?-~… '

# Longest digraphs first:
_DIGRAPHS = (
    'ng', 'ny', 'sy', 'ts', 'kh', 'th',
)

_SINGLE = {
    'a': 'a', 'b': 'b', 'd': 'd', 'e': 'e', 'f': 'f', 'g': 'g', 'h': 'h',
    'i': 'i', 'j': 'j', 'k': 'k', 'm': 'm', 'n': 'n', 'o': 'o', 'p': 'p',
    'r': 'r', 's': 's', 't': 't', 'u': 'u', 'v': 'v', 'w': 'w', 'z': 'z',
    'c': 'ʧ', 'l': 'r', 'y': 'j', 'q': 'k', 'x': 'ks',
}

_DIGRAPH_TO_PHONE = {
    'ng': 'N',   # ŋ
    'ny': 'nj',  # ɲ
    'sy': 'ʃ',
    'ts': 'ʦ',
    'kh': 'k',
    'th': 't',
}

_ONES = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan']
_TEENS = ['sepuluh', 'sebelas', 'dua belas', 'tiga belas', 'empat belas', 'lima belas',
          'enam belas', 'tujuh belas', 'delapan belas', 'sembilan belas']
_TENS = ['', '', 'dua puluh', 'tiga puluh', 'empat puluh', 'lima puluh',
         'enam puluh', 'tujuh puluh', 'delapan puluh', 'sembilan puluh']

_NUMBER_RE = re.compile(r'\d+(?:,\d{3})*(?:\.\d+)?')


def _under_1000(n: int) -> str:
    out = []
    ratus, rest = divmod(n, 100)
    if ratus:
        out.append('seratus' if ratus == 1 else f'{_ONES[ratus]} ratus')
    puluh, satuan = divmod(rest, 10)
    if puluh:
        if rest >= 10 and rest < 20:
            out.append(_TEENS[rest - 10])
        else:
            out.append(_TENS[puluh])
            if satuan:
                out.append(_ONES[satuan])
    elif satuan:
        out.append(_ONES[satuan])
    return ' '.join(out) if out else 'nol'


def _to_indo_number(text: str) -> str:
    """Replace digit groups (integers or decimals) with Indonesian words."""
    def repl(m: re.Match) -> str:
        token = m.group(0)
        if '.' in token:
            whole, _, frac = token.partition('.')
            words = [_to_indo_number(whole), 'koma', _to_indo_number(frac)]
            return ' '.join(w for w in words if w != 'nol')
        n = int(token.replace(',', ''))
        if n == 0:
            return 'nol'
        out = []
        for unit_val, unit in ((10 ** 9, 'miliar'), (10 ** 6, 'juta'), (10 ** 3, 'ribu')):
            value, n = divmod(n, unit_val)
            if value:
                if value == 1 and unit == 'ribu':
                    out.append('seribu')
                else:
                    out.append(_under_1000(value))
                    out.append(unit)
        if n:
            out.append(_under_1000(n))
        return ' '.join(out)

    return _NUMBER_RE.sub(repl, text)


def indonesian_cleaner(text: str) -> str:
    text = _to_indo_number(text).lower()
    out = []
    i = 0
    n = len(text)
    while i < n:
        two = text[i:i + 2]
        if len(two) == 2 and two in _DIGRAPH_TO_PHONE:
            out.append(_DIGRAPH_TO_PHONE[two])
            i += 2
            continue
        ch = text[i]
        if ch in _SINGLE:
            out.append(_SINGLE[ch])
        elif ch in _KEEP:
            out.append(ch)
        i += 1
    text = ''.join(out)
    return ' '.join(text.split())