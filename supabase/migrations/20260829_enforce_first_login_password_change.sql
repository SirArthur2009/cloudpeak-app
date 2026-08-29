update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('must_change_password', true)
where coalesce(raw_user_meta_data ->> 'must_change_password', 'false') = 'true'
  and coalesce(raw_app_meta_data ->> 'must_change_password', 'false') <> 'true';