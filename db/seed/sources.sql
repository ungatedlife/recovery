-- Idempotent reference rows: fellowships that have a scraper, and the scrape sources.
-- Applied by the bootstrap job on every run and by `wrangler d1 execute`.
INSERT OR IGNORE INTO fellowships (code,name,color,color_dark,website,sort_order,active) VALUES
  ('ACA','Adult Children of Alcoholics & Dysfunctional Families','#6b7a2f','#b3c266','https://adultchildren.org',60,0);
INSERT OR IGNORE INTO sources (id,fellowship,adapter,url,config_json,cadence_hours,default_tz,enabled) VALUES
  ('ua-tsml','UA','tsml-feed','https://www.underearnersanonymous.org/meetings-underearners-anonymous/','{"site":"https://www.underearnersanonymous.org"}',168,'America/New_York',1),
  ('eda-tsml','EDA','tsml-feed','https://eatingdisordersanonymous.org/meetings/','{"site":"https://eatingdisordersanonymous.org"}',168,'America/New_York',1),
  ('slaa-teamup','SLAA','teamup','https://slaavirtual.org/meetingcalendar/','{"calendarKey":""}',168,'America/New_York',0),
  ('aca-teamup','ACA','teamup','https://adultchildren.org/meeting-search/','{"calendarKey":"kse84zjj5qb58oiren"}',168,'America/New_York',0);
