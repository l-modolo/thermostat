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

get_data <- function(data_path){
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
    mutate(calendar = ifelse(heat == 1, calendar, NA)) %>% 
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
    mutate(
      type = ifelse(str_detect(captors, "humidity"), "humidity", "temperature"),
      localisation = ifelse(
        str_detect(captors, "outdoor") | str_detect(captors, "exterior"),
        "outdoor", "indoor"),
      day = lubridate::hour(date) >= 20 | lubridate::hour(date) <= 7,
      ) %>% 
    mutate(
      heat = as_factor(ifelse(heat == 1, "on", "off")),
      heat = fct_relevel(heat, "off"),
      day = as_factor(ifelse(day, "night", "day"))
    )
}

get_data(data_path) %>% 
  sample_frac(size = 1/10) %>% 
  ggplot() +
  geom_point(aes(
    x = date,
    y = values,
    color = captors,
    alpha = day,
  )) +
  facet_wrap(~localisation + type, scales = "free_y") +
  theme_bw()

get_data(data_path) %>% 
  filter(type == "temperature") %>% 
  sample_frac(size = 1/10) %>% 
  ggplot() +
  geom_point(aes(
    x = date,
    y = values,
    color = captors,
    alpha = day,
    shape = day
    ),
   size = 1) +
  scale_alpha_discrete(range = c(0.5, 1)) +
  facet_wrap(~localisation, scales = "free_y", nrow = 2) +
  scale_y_log10() +
  theme_bw()
