#include <iostream>

struct Gate {
  int id() const { return 7; }
};

int main(int argc, char** argv) {
  std::cout << "CANDIDATE MAIN RAN " << argc << (argv != nullptr) << "\n";
  return 0;
}
