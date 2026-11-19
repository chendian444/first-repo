CC ?= cc
CFLAGS ?= -std=c11 -O2 -g -Wall -Wextra -Werror -Wpedantic

all: build/collector
build/collector: src/collector.c
	mkdir -p build
	$(CC) $(CFLAGS) $< -o $@
sanitize:
	mkdir -p build
	$(CC) -std=c11 -O1 -g -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer src/collector.c -o build/collector-sanitize
test: all
	python3 -m unittest discover -s tests -v
clean:
	rm -rf build
.PHONY: all sanitize test clean
