library("tidyverse")
library("tidymodels")
colnames <- c(
  "date",
  "heat",
  "calendar",
  "indoor_temperature",
  "indoor_humidity",
  "indoor_hi",
  "indoor_controler_temperature",
  "outdoor_temperature",
  "outdoor_humidity",
  "outdoor_hi",
  "clim_temperature_interior",
  "clim_humidity_interior",
  "clim_temperature_exterior"
)

data_path <- "server/readings/"

tibble(file = str_c(data_path, list.files(path = data_path))) %>% 
  filter(str_detect(file, "_logs.csv")) %>% 
  group_by(file) %>% 
  mutate(
    data = lapply(X = file, FUN = function(x, colnames){
      read_csv(file = file, col_names = colnames)
    }, colnames = colnames)
  ) %>% 
  ungroup() %>% 
  select(-c(file)) %>% 
  unnest(c(data)) %>% 
  mutate(date = lubridate::as_datetime(date/1000), origin = lubridate::origin) %>% 
  pivot_longer(
    cols = c(calendar,
             indoor_temperature,
             indoor_controler_temperature,
             outdoor_temperature,
             clim_temperature_interior,
             clim_temperature_exterior,
             indoor_humidity,
             outdoor_humidity,
             clim_humidity_interior),
    names_to = "captors",
    values_to = "values"
  ) %>% 
  mutate(type = ifelse(str_detect(captors, "humidity"),
                       "humidity", "temperature"),
         day = lubridate::hour(date) >= 20 | lubridate::hour(date) <= 7,
         ) %>% 
  group_by(date, type) %>% 
  mutate(heat_value = ifelse(heat == 1, mean(values), NA),
         day_value = ifelse(day, mean(values) - 2, NA)
  ) %>% 
  ggplot() +
  geom_point(
    aes(
      x = date,
      y = heat_value
    ),
    color = "red"
  ) +
  geom_point(
    aes(
      x = date,
      y = day_value
    ),
    color = "grey50"
  ) +
  geom_line(aes(
    x = date,
    y = values,
    color = captors
  )) +
  facet_wrap(~type, scales = "free_y") +
  theme_bw()

