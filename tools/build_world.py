#!/usr/bin/env python3
"""Builds world.js: every carillon in Wikipedia's lists of carillons, with a position on the globe.

Run from the project folder:  python3 tools/build_world.py
Pages and geocoding answers are cached in tools/cache/, so a second run is quick; delete that folder to start afresh.
Text is from Wikipedia (CC BY-SA 4.0); positions are from OpenStreetMap's Nominatim geocoder (ODbL).
Positions are looked up by tower name first and by town second, so many are only accurate to the town.
"""
import json, os, re, subprocess, sys, time, urllib.parse
from html.parser import HTMLParser

UA = {'User-Agent': 'carillon-explorer-build/1.0'}
CACHE = 'tools/cache'
os.makedirs(CACHE, exist_ok=True)

# (language, page title, country or None when the page's headings name the country, table layout)
PAGES = [
    ('en', 'List of carillons in the United States', 'USA', 'en-lb'),
    ('en', 'List of carillons in Belgium', 'Belgium', 'en-kg'),
    ('en', 'List of carillons of the British Isles', None, 'en-kg'),
    ('en', 'List of carillons in Germany', 'Germany', 'en-kg'),
    ('en', 'List of carillons in Australia and New Zealand', None, 'en-kg'),
    ('nl', 'Lijst van beiaarden in Nederland', 'Netherlands', 'nl'),
    ('en', 'List of carillons', None, 'bullets'),
]
SKIP_SECTIONS = {'Belgium', 'British Isles', 'Germany', 'United States', 'Australia', 'New Zealand', 'Netherlands',
                 'See also', 'Notes', 'References', 'External links', 'Further reading', 'Criteria for inclusion',
                 'List of mobile carillons', 'Reizende beiaarden', 'Hedendaagse beiaardiers', 'Traveling carillons', 'Travelling carillons'}
HEADING_COUNTRY = {'England': 'England', 'Scotland': 'Scotland', 'Northern Ireland': 'Northern Ireland', 'Republic of Ireland': 'Ireland',
                   'Australia': 'Australia', 'New Zealand': 'New Zealand'}


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.kids = tag, dict(attrs), parent, []

    def text(self):
        out = []
        for k in self.kids:
            if isinstance(k, str): out.append(k)
            elif k.tag in ('sup', 'style', 'script'): continue   # footnote markers
            elif k.tag == 'br': out.append('\n')
            else:
                out.append(k.text())
                if k.tag in ('li', 'div', 'p'): out.append('\n')
        return ''.join(out)

    def find(self, tag):
        for k in self.kids:
            if isinstance(k, Node):
                if k.tag == tag: yield k
                yield from k.find(tag)


class Tree(HTMLParser):
    VOID = {'br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'col', 'source'}

    def __init__(self):
        super().__init__(); self.root = self.cur = Node('root', [], None)

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.cur); self.cur.kids.append(n)
        if tag not in self.VOID: self.cur = n

    def handle_endtag(self, tag):
        n = self.cur
        while n and n.tag != tag: n = n.parent
        if n and n.parent: self.cur = n.parent

    def handle_data(self, data): self.cur.kids.append(data)


def get(url, key, pause=0.0):
    path = os.path.join(CACHE, re.sub(r'[^A-Za-z0-9]+', '_', key)[:150] + '.json')
    if os.path.exists(path): return json.load(open(path))
    for attempt in range(4):   # curl, because Python's own downloader proved very slow against these servers
        got = subprocess.run(['curl', '-sS', '-m', '40', '-A', UA['User-Agent'], url], capture_output=True, text=True)
        try: data = json.loads(got.stdout); break
        except ValueError:
            if attempt == 3: raise
            time.sleep(5 * (attempt + 1))
    json.dump(data, open(path, 'w')); time.sleep(pause)
    return data


def clean(s): return re.sub(r'\s+', ' ', re.sub(r'\s*\[(?:[a-z]{2,3}(?:;\s*)?)+\]|\[\d+\]', '', s)).strip(' \n:.,;–—-')
def first_line(s): return clean(s.strip().split('\n')[0])
def number(s):
    m = re.search(r'\d[\d,.]*', s.replace('\xa0', ''))
    return float(m.group().replace(',', '')) if m else None
def image(node):
    for img in node.find('img'):
        m = re.search(r'/thumb/[0-9a-f]/[0-9a-f]{2}/([^/]+)/', img.attrs.get('src', ''))
        if m and not m.group(1).lower().endswith('.svg'): return urllib.parse.unquote(m.group(1)).replace('_', ' ')
    return None


def walk(root):
    """Headings and tables / top-level lists in document order."""
    def rec(n):
        for k in n.kids:
            if not isinstance(k, Node): continue
            if k.tag in ('h2', 'h3', 'h4'): yield ('h', int(k.tag[1]), clean(k.text().replace('[edit]', '')))
            elif k.tag == 'table' and 'wikitable' in k.attrs.get('class', ''): yield ('table', k, None)
            elif k.tag == 'ul': yield ('ul', k, None)
            else: yield from rec(k)
    yield from rec(root)


def rows(table):
    """Rows of cells, with a cell that spans several rows repeated in each of them."""
    pending = {}
    for tr in table.find('tr'):
        cells = iter([c for c in tr.kids if isinstance(c, Node) and c.tag in ('td', 'th')])
        row, col, nxt = [], 0, None
        nxt = next(cells, None)
        while nxt is not None or col in pending:
            if col in pending:
                row.append(pending[col][0]); pending[col][1] -= 1
                if pending[col][1] <= 0: del pending[col]
            else:
                row.append(nxt)
                span = int(re.sub(r'\D', '', nxt.attrs.get('rowspan', '1')) or 1)
                if span > 1: pending[col] = [nxt, span - 1]
                nxt = next(cells, None)
            col += 1
        if row: yield row


entries = []
for lang, title, country, layout in PAGES:
    api = f'https://{lang}.wikipedia.org/w/api.php?' + urllib.parse.urlencode(
        {'action': 'parse', 'page': title, 'prop': 'text', 'format': 'json', 'formatversion': 2, 'redirects': 1})
    tree = Tree(); tree.feed(get(api, f'page {lang} {title}', 1.5)['parse']['text'])
    h2 = h3 = ''
    before = len(entries)
    for kind, node, text in walk(tree.root):
        if kind == 'h':
            if node == 2: h2, h3 = text, ''
            else: h3 = text
            continue
        section = h3 or h2
        if h2 in SKIP_SECTIONS - (set() if layout == 'bullets' else set(HEADING_COUNTRY)) or (layout == 'bullets' and h3 in SKIP_SECTIONS): continue
        if kind == 'table' and layout.startswith('en'):
            for cells in rows(node):
                head = next((k for k, c in enumerate(cells) if c.tag == 'th' and c.attrs.get('scope') == 'row'), None)
                if head is None: continue
                rest = cells[head + 1:]
                if len(rest) < 2: continue
                e = {'name': first_line(cells[head].text()), 'city': first_line(rest[0].text()), 'bells': number(rest[1].text()),
                     'country': country or HEADING_COUNTRY.get(h2, h2), 'area': section if country == 'USA' else '', 'photo': image(cells[0]) if head else None}
                if len(rest) > 3 and rest[2].attrs.get('colspan') != '2':
                    a, b = number(rest[2].text()), number(rest[3].text())
                    kg = b if layout == 'en-lb' else a
                    if kg: e['kg'] = kg
                if len(rest) >= 4: e['maker'] = clean(re.sub(r'(,\s*)+', ', ', re.sub(r'\[[^\]]*\]', '', rest[-2].text().strip().replace('\n', ', '))))
                entries.append(e)
        elif kind == 'table' and layout == 'nl':
            for cells in rows(node):
                if cells[0].tag == 'th' or len(cells) < 5: continue
                place = cells[1]
                links = [clean(a.text()) for a in place.find('a')]
                txt = first_line(place.text())
                city = clean(re.sub(r'^\d{4}\s?[A-Z]{2}\s+', '', txt.split(',')[-1])) if ',' in txt else (links[-1] if links else txt)
                entries.append({'name': first_line(cells[0].text()), 'city': city, 'country': 'Netherlands', 'area': section,
                                'bells': number(cells[4].text()), 'maker': clean(re.sub(r'(,\s*)+', ', ', cells[3].text().strip().replace('\n', ', '))), 'since': clean(cells[2].text())[:4],
                                'photo': image(cells[-1])})
        elif kind == 'ul' and (h3 if layout == 'bullets' else layout.startswith('en') and h2):
            for li in (k for k in node.kids if isinstance(k, Node) and k.tag == 'li'):
                subs = [s for ul in li.kids if isinstance(ul, Node) and ul.tag == 'ul' for s in ul.kids if isinstance(s, Node) and s.tag == 'li']
                own = ''.join(k if isinstance(k, str) else ('' if k.tag in ('ul', 'sup', 'style') else k.text()) for k in li.kids)
                city = clean(re.split(r'[:–—]|\{', own)[0]) if own.strip() else ''
                for item in (subs or [li]):
                    t = clean(item.text() if subs else own)
                    body = t if subs else clean(t[len(city):]) if t.startswith(city) else t
                    m = re.search(r'(\d+)\s+bells', t)
                    name = clean(re.split(r'[–—,(]|(?<!\bSt)(?<!\b[A-Z])\.| \d+ bells|:| houses? ', body)[0]) or city
                    # Tidy names lifted from running text: "The X", "in the X at Y", "X has a carillon…", "X installed in 1931"
                    name = clean(re.split(r' has\b| installed\b| located\b| with$| is\b| was\b', name)[0])
                    name = clean(re.sub(r'^(?:The|A|In the|At the|At|In)\s+', '', name, flags=re.I))
                    if len(name) > 60: name = clean(re.split(r' (?:in|at|on|of) the ', name)[0])
                    if re.match(r'(?:Installed|Erected|Built|Dedicated|Sister|Originally|Located)\b', name, re.I): name = ''
                    if re.match(r'\d|carillon$|bells', name, re.I) or len(name) < 3: name = city + ' carillon'
                    if not city or len(city) > 40 or len(name) > 70: continue
                    e = {'name': name, 'city': city, 'country': country or h3, 'area': section if country == 'USA' else '',
                         'bells': float(m.group(1)) if m else None, 'photo': None}
                    w = re.search(r'heaviest\s+([\d,.]+)\s*kg', t.replace('\xa0', ' '))
                    if w: e['kg'] = float(w.group(1).replace(',', ''))
                    y = re.search(r'\b(1[5-9]\d\d|20[0-2]\d)\b', t)   # the first year the text mentions, usually when the carillon was installed
                    if y: e['since'] = y.group(1)
                    entries.append(e)
    print(f'{title}: {len(entries) - before} entries', file=sys.stderr)

# Drop junk and duplicates
seen, kept = set(), []
for e in entries:
    key = (e['name'].lower(), e['city'].lower())
    if not e['name'] or not e['city'] or key in seen or (e.get('bells') or 99) < 20: continue
    seen.add(key); kept.append(e)
print(f'{len(kept)} carillons after tidying; geocoding…', file=sys.stderr)

out, missing = [], 0
for n, e in enumerate(kept):
    where = ', '.join(x for x in (e['city'], e.get('area'), e['country']) if x)
    hit = None
    for q in (f"{e['name']}, {where}", where):
        url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'format': 'jsonv2', 'limit': 1})
        try: r = get(url, 'geo ' + q, 1.1)
        except Exception: r = []
        if r: hit = r[0]; break
    if not hit: missing += 1; continue
    exact = 1 if q != where else 0   # found by the tower's own name, not just its town
    row = [e['name'], e['city'], e['country'], round(float(hit['lat']), 4), round(float(hit['lon']), 4), int(e['bells'] or 0),
           round(e.get('kg', 0)), e.get('maker', '')[:90], e.get('photo') or '', e.get('since', ''), exact]
    out.append(row)
    if n % 50 == 0: print(f'  {n}/{len(kept)}', file=sys.stderr)

with open('world.js', 'w') as f:
    f.write('// Every carillon in Wikipedia\'s lists of carillons. Built by tools/build_world.py; do not edit by hand.\n'
            '// Text: Wikipedia, CC BY-SA 4.0. Positions: OpenStreetMap Nominatim, ODbL; many are only accurate to the town.\n'
            '// Each row: name, town, country, latitude, longitude, bells (0 = not listed), heaviest bell in kg (0 = not listed), bell founders, photo, year, 1 if placed by the name of the tower (0 = only at its town).\n'
            'window.WORLD = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')).replace('],[', '],\n[') + ';\n')
print(f'wrote {len(out)} carillons to world.js ({missing} could not be placed)', file=sys.stderr)
