FROM cashubtc/nutshell:0.20.3@sha256:f039b0e61f64d67c7212f5472eb5d021c3703cd9e72170aa924906ce6bd1f2ed

EXPOSE 3338
CMD ["poetry", "run", "mint"]
