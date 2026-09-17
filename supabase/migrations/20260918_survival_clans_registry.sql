-- Droidz Survival — the clan registry (18.09.2026).
-- Communities a player can fly the flag of, each tied to its OpenSea collection so the
-- game shows the collection's own PFP; managed from spltpnl (add = look the slug up on
-- OpenSea, store the image; remove = deactivate). Seeded with the owner's eleven.
create table if not exists survival_clans (
    slug          text primary key,
    name          text not null,
    opensea_slug  text,
    chain         text,
    contract      text,
    image_url     text,
    sort          int  not null default 0,
    active        boolean not null default true,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
alter table survival_clans enable row level security;
insert into survival_clans (slug, name, opensea_slug, chain, contract, image_url) values
 ('apedroidz',    'ApeDroidz',    'apedroidz',        'ape_chain', '0x4e0edc9be4d47d414daf8ed9a6471f41e99577f3', 'https://i2c.seadn.io/collection/apedroidz/image_type_logo/7dd74e127791f78a13fafeedbbd587/fd7dd74e127791f78a13fafeedbbd587.png'),
 ('gobs-on-ape',  'Gobs on Ape',  'gobs-on-ape',      'ape_chain', '0xbebaa24108d6a03c7331464270b95278bbbe6ff7', 'https://i2c.seadn.io/ape_chain/1739462f365044cb97e167bd05e5d68e/15e422cbacb97db4161ce898125412/9815e422cbacb97db4161ce898125412.png'),
 ('geez-on-ape',  'Geez on Ape',  'geez-on-ape',      'ape_chain', '0xdff12cc0032bae20dcbbe21d60f0bd53fbd3ee62', null),
 ('balloons',     'balloons',     'balloons',         'ape_chain', '0x110cc263cc9241c1848e4d7f06d962d07040f238', null),
 ('trenchers',    'Trenchers',    'trenchers',        'ethereum',  '0x495f947276749ce646f68ac8c248420045cb7b5e', 'https://i2c.seadn.io/collection/trenchers/image/852ebe3abc787903e5356282460f3e/6e852ebe3abc787903e5356282460f3e.png'),
 ('ape-church',   'Ape Church',   'ape-church',       'ape_chain', '0x42124921ee19c400e424ffa3a51b577e0550ed79', 'https://i2c.seadn.io/collection/ape-church/image_type_logo/639a7207349dad95f940694f19d512/a6639a7207349dad95f940694f19d512.jpeg'),
 ('jnkyz',        'JNKYZ',        'jnkyz',            'ape_chain', '0xfdb917b599ba8898325373b34454385489285c10', 'https://i2c.seadn.io/collection/jnkyz-530836667/image_type_logo/4de33c582d2f6734efa57dc2d30698/344de33c582d2f6734efa57dc2d30698.png'),
 ('nightglyders', 'NightGlyders', 'nightglyders',     'ape_chain', '0x41232b4b2c6c1abe0238e590f4bd433c166a6b01', 'https://i2c.seadn.io/collection/nightglyders/image_type_logo/5a41cb8af0455f4d0469c8b4e9787c/f45a41cb8af0455f4d0469c8b4e9787c.gif'),
 ('flingers',     'FLINGERS',     'flingers',         'ape_chain', '0x25ae265fc0bab9b23770f69a6709523f24b1c753', 'https://i2c.seadn.io/ape_chain/a58bd674a5eb4e46abbe77242a144357/436ceb6e269bea337b82cdef8ca2f2/8e436ceb6e269bea337b82cdef8ca2f2.webp'),
 ('bayc',         'BAYC',         'boredapeyachtclub','ethereum',  '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', 'https://i2c.seadn.io/collection/boredapeyachtclub/image/1a09c26b1c30427b26944c47fc7bb9/d81a09c26b1c30427b26944c47fc7bb9.png'),
 ('koda',         'KODA',         'koda',             'ethereum',  '0x495f947276749ce646f68ac8c248420045cb7b5e', 'https://i2c.seadn.io/collection/koda/image/fb46355c817b3cf091fe43000db512/bafb46355c817b3cf091fe43000db512.jpeg')
on conflict (slug) do nothing;
