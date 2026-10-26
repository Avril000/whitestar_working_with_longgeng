# -*- coding: utf-8 -*-
"""干跑：按 merge_cards 的弃字规则过一遍所有卡片，只报数不改任何文件。"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import merge_cards as M
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

tally = collections.Counter()
per_file = collections.Counter()
books = collections.Counter()
samples = collections.defaultdict(list)

cards = sorted(M.CARD_DIR.glob('卡片_*.csv'))
for c in cards:
    for row in M.read_rows(c):
        if not M.pick(row, 'char'):
            continue
        row['_src_file'] = c.name
        why = M.drop_reason(row)
        if not why:
            continue
        tally[why] += 1
        per_file[c.name] += 1
        books[M.pick(row, 'book', '多宝塔碑')] += 1
        if len(samples[why]) < 5:
            samples[why].append('%s 【%s】 %s  %s' % (
                M.pick(row, 'char'), M.pick(row, 'char'),
                M.pick(row, 'src_page'), M.pick(row, 'note')))

print('=== 命中弃字规则的条数：%d ===' % sum(tally.values()))
for why, n in tally.most_common():
    print('\n %3d 条  理由：%s' % (n, why))
    for s in samples[why]:
        print('        ', s)
print('\n=== 按碑 ===', dict(books))
print('=== 按卡片 ===')
for f, n in per_file.most_common():
    print('   %3d  %s' % (n, f))
